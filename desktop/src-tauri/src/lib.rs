use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{path::BaseDirectory, Manager, State};
use thiserror::Error;

#[derive(Debug, Error)]
enum DesktopError {
    #[error("Codex CLI를 찾지 못했습니다. RiskShield를 다시 설치하거나 RISKSHIELD_CODEX_BIN을 확인하세요.")]
    CodexMissing,
    #[error("Codex App Server를 시작하지 못했습니다: {0}")]
    Spawn(String),
    #[error("Codex App Server 연결이 종료되었습니다.")]
    Disconnected,
    #[error("Codex App Server가 제한 시간 안에 응답하지 않았습니다. 다시 시도하세요.")]
    Timeout,
    #[error("Codex App Server 오류: {0}")]
    Rpc(String),
    #[error("Codex 응답을 읽지 못했습니다: {0}")]
    Protocol(String),
    #[error("로컬 기록 저장소 오류: {0}")]
    Database(String),
}

impl Serialize for DesktopError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

struct AppServer {
    child: Child,
    stdin: ChildStdin,
    messages: Receiver<Result<Value, String>>,
    next_id: u64,
}

impl Drop for AppServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl AppServer {
    fn start(binary: &Path) -> Result<Self, DesktopError> {
        let mut child = Command::new(binary)
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    DesktopError::CodexMissing
                } else {
                    DesktopError::Spawn(error.to_string())
                }
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| DesktopError::Spawn("stdin 연결 실패".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| DesktopError::Spawn("stdout 연결 실패".into()))?;
        let (sender, messages) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) if line.trim().is_empty() => continue,
                    Ok(_) => {
                        let parsed = serde_json::from_str(&line)
                            .map_err(|error| format!("JSON 파싱 실패: {error}"));
                        if sender.send(parsed).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(format!("stdout 읽기 실패: {error}")));
                        break;
                    }
                }
            }
        });
        let mut server = Self {
            child,
            stdin,
            messages,
            next_id: 1,
        };

        server.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "riskshield_desktop",
                    "title": "RiskShield Desktop",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
        )?;
        server.notify("initialized", json!({}))?;
        Ok(server)
    }

    fn send(&mut self, value: &Value) -> Result<(), DesktopError> {
        serde_json::to_writer(&mut self.stdin, value)
            .map_err(|error| DesktopError::Protocol(error.to_string()))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| DesktopError::Protocol(error.to_string()))
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), DesktopError> {
        self.send(&json!({ "method": method, "params": params }))
    }

    fn read_message_with_timeout(&mut self, timeout: Duration) -> Result<Value, DesktopError> {
        match self.messages.recv_timeout(timeout) {
            Ok(Ok(message)) => Ok(message),
            Ok(Err(error)) => Err(DesktopError::Protocol(error)),
            Err(RecvTimeoutError::Timeout) => Err(DesktopError::Timeout),
            Err(RecvTimeoutError::Disconnected) => Err(DesktopError::Disconnected),
        }
    }

    fn read_message(&mut self) -> Result<Value, DesktopError> {
        self.read_message_with_timeout(Duration::from_secs(120))
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, DesktopError> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({ "method": method, "id": id, "params": params }))?;

        loop {
            let message = self.read_message_with_timeout(Duration::from_secs(30))?;
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                let detail = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("알 수 없는 오류");
                return Err(DesktopError::Rpc(detail.to_owned()));
            }
            return message
                .get("result")
                .cloned()
                .ok_or_else(|| DesktopError::Protocol("result 필드가 없습니다.".into()));
        }
    }
}

struct CodexState {
    server: Mutex<Option<AppServer>>,
    bundled_binary: PathBuf,
}

impl CodexState {
    fn new(bundled_binary: PathBuf) -> Self {
        Self {
            server: Mutex::new(None),
            bundled_binary,
        }
    }

    fn resolve_binary(&self) -> Result<PathBuf, DesktopError> {
        if let Some(path) = env::var_os("RISKSHIELD_CODEX_BIN").map(PathBuf::from) {
            if path.is_file() {
                return Ok(path);
            }
            return Err(DesktopError::CodexMissing);
        }

        let executable = if cfg!(windows) { "codex.exe" } else { "codex" };
        if let Some(path) = env::var_os("PATH").and_then(|paths| {
            env::split_paths(&paths)
                .map(|directory| directory.join(executable))
                .find(|candidate| candidate.is_file())
        }) {
            return Ok(path);
        }

        self.bundled_binary
            .is_file()
            .then(|| self.bundled_binary.clone())
            .ok_or(DesktopError::CodexMissing)
    }

    fn with<T>(
        &self,
        action: impl FnOnce(&mut AppServer) -> Result<T, DesktopError>,
    ) -> Result<T, DesktopError> {
        let mut guard = self
            .server
            .lock()
            .map_err(|_| DesktopError::Protocol("Codex 상태 잠금 실패".into()))?;
        if guard.is_none() {
            *guard = Some(AppServer::start(&self.resolve_binary()?)?);
        }
        let result = action(guard.as_mut().expect("app server initialized"));
        if result.is_err() {
            guard.take();
        }
        result
    }
}

#[derive(Clone)]
struct DatabasePath(PathBuf);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountInfo {
    connected: bool,
    email: Option<String>,
    plan_type: Option<String>,
    auth_mode: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginChallenge {
    login_id: String,
    verification_url: String,
    user_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RateWindow {
    used_percent: f64,
    window_duration_mins: u64,
    resets_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RateLimits {
    primary: Option<RateWindow>,
    secondary: Option<RateWindow>,
    reached_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveInput {
    input: String,
    rules: Value,
    ai: Option<Value>,
    mode: String,
    validation_issues: Vec<Value>,
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for part in path {
        cursor = cursor.get(*part)?;
    }
    cursor.as_str().map(ToOwned::to_owned)
}

fn rate_window(value: Option<&Value>) -> Option<RateWindow> {
    let value = value?;
    Some(RateWindow {
        used_percent: value.get("usedPercent")?.as_f64()?,
        window_duration_mins: value.get("windowDurationMins")?.as_u64()?,
        resets_at: value.get("resetsAt")?.as_u64()?,
    })
}

#[tauri::command]
fn account_read(state: State<'_, CodexState>) -> Result<AccountInfo, DesktopError> {
    state.with(|server| {
        let result = server.request("account/read", json!({ "refreshToken": false }))?;
        let account = result.get("account");
        let account_type = account
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str);
        Ok(AccountInfo {
            connected: account_type == Some("chatgpt"),
            email: account
                .and_then(|value| value.get("email"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            plan_type: account
                .and_then(|value| value.get("planType"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            auth_mode: account_type.map(ToOwned::to_owned),
        })
    })
}

#[tauri::command]
fn login_start(state: State<'_, CodexState>) -> Result<LoginChallenge, DesktopError> {
    state.with(|server| {
        let result = server.request(
            "account/login/start",
            json!({ "type": "chatgptDeviceCode" }),
        )?;
        Ok(LoginChallenge {
            login_id: string_at(&result, &["loginId"])
                .ok_or_else(|| DesktopError::Protocol("loginId 누락".into()))?,
            verification_url: string_at(&result, &["verificationUrl"])
                .ok_or_else(|| DesktopError::Protocol("verificationUrl 누락".into()))?,
            user_code: string_at(&result, &["userCode"])
                .ok_or_else(|| DesktopError::Protocol("userCode 누락".into()))?,
        })
    })
}

#[tauri::command]
fn logout(state: State<'_, CodexState>) -> Result<(), DesktopError> {
    state.with(|server| {
        server.request("account/logout", json!({}))?;
        Ok(())
    })
}

#[tauri::command]
fn rate_limits_read(state: State<'_, CodexState>) -> Result<RateLimits, DesktopError> {
    state.with(|server| {
        let result = server.request("account/rateLimits/read", json!({}))?;
        let limits = result.get("rateLimits").unwrap_or(&Value::Null);
        Ok(RateLimits {
            primary: rate_window(limits.get("primary")),
            secondary: rate_window(limits.get("secondary")),
            reached_type: limits
                .get("rateLimitReachedType")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        })
    })
}

fn analysis_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" },
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "category": { "type": "string" },
                        "severity": { "type": "string", "enum": ["low", "review", "high"] },
                        "evidence": { "type": "string" },
                        "explanation": { "type": "string" },
                        "rewrite": { "type": ["string", "null"] },
                        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
                    },
                    "required": ["category", "severity", "evidence", "explanation", "rewrite", "confidence"],
                    "additionalProperties": false
                }
            },
            "model": { "type": ["string", "null"] }
        },
        "required": ["summary", "findings", "model"],
        "additionalProperties": false
    })
}

#[tauri::command]
fn codex_analyze(
    input: String,
    rules: Value,
    state: State<'_, CodexState>,
) -> Result<Value, DesktopError> {
    state.with(|server| {
        let thread = server.request(
            "thread/start",
            json!({
                "ephemeral": true,
                "approvalPolicy": "never",
                "sandboxPolicy": { "type": "readOnly" },
                "serviceName": "riskshield-desktop"
            }),
        )?;
        let thread_id = string_at(&thread, &["thread", "id"])
            .ok_or_else(|| DesktopError::Protocol("thread id 누락".into()))?;
        let model = string_at(&thread, &["thread", "model"])
            .or_else(|| string_at(&thread, &["model"]));
        let prompt = format!(
            "당신은 RiskShield의 문맥 검토기입니다. 도구를 사용하지 마세요. \
             원문에 실제로 존재하는 연속 문자열만 evidence로 인용하세요. \
             원문에 없는 수치, 조건, 사실을 rewrite에 추가하지 마세요. \
             비판·경고·인용·보도 문맥은 위험을 직접 지지하는 표현과 구분하세요. \
             규칙 결과는 참고 신호이지 정답이 아닙니다.\n\n원문:\n{}\n\nAnalyzer v4 규칙 결과:\n{}",
            input,
            serde_json::to_string(&rules)
                .map_err(|error| DesktopError::Protocol(error.to_string()))?
        );
        let turn = server.request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{ "type": "text", "text": prompt }],
                "approvalPolicy": "never",
                "sandboxPolicy": { "type": "readOnly" },
                "outputSchema": analysis_schema()
            }),
        )?;
        let turn_id = string_at(&turn, &["turn", "id"])
            .ok_or_else(|| DesktopError::Protocol("turn id 누락".into()))?;
        let mut agent_text: Option<String> = None;

        loop {
            let message = server.read_message()?;
            match message.get("method").and_then(Value::as_str) {
                Some("item/completed") => {
                    let item = &message["params"]["item"];
                    if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
                        agent_text = item
                            .get("text")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned);
                    }
                }
                Some("turn/completed") => {
                    let completed = &message["params"]["turn"];
                    if completed.get("id").and_then(Value::as_str) != Some(&turn_id) {
                        continue;
                    }
                    if completed.get("status").and_then(Value::as_str) != Some("completed") {
                        let detail = completed["error"]["message"]
                            .as_str()
                            .unwrap_or("Codex 분석이 완료되지 않았습니다.");
                        return Err(DesktopError::Rpc(detail.to_owned()));
                    }
                    break;
                }
                Some("error") => {
                    let detail = message["params"]["error"]["message"]
                        .as_str()
                        .unwrap_or("Codex 분석 오류");
                    return Err(DesktopError::Rpc(detail.to_owned()));
                }
                _ => {}
            }
        }

        let raw = agent_text.ok_or_else(|| DesktopError::Protocol("최종 분석 메시지 누락".into()))?;
        let mut parsed: Value = serde_json::from_str(&raw)
            .map_err(|error| DesktopError::Protocol(format!("구조화 응답 파싱 실패: {error}")))?;
        if let Some(object) = parsed.as_object_mut() {
            object.insert("model".into(), model.map_or(Value::Null, Value::String));
        }
        Ok(parsed)
    })
}

fn connection(path: &DatabasePath) -> Result<Connection, DesktopError> {
    Connection::open(&path.0).map_err(|error| DesktopError::Database(error.to_string()))
}

#[tauri::command]
fn save_analysis(payload: SaveInput, db: State<'_, DatabasePath>) -> Result<i64, DesktopError> {
    let connection = connection(&db)?;
    connection
        .execute(
            "INSERT INTO analyses (created_at, input, rules_json, ai_json, mode, validation_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                chrono::Utc::now().to_rfc3339(),
                payload.input,
                payload.rules.to_string(),
                payload.ai.map(|value| value.to_string()),
                payload.mode,
                Value::Array(payload.validation_issues).to_string(),
            ],
        )
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    Ok(connection.last_insert_rowid())
}

#[tauri::command]
fn list_history(db: State<'_, DatabasePath>) -> Result<Vec<Value>, DesktopError> {
    let connection = connection(&db)?;
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, input, rules_json, ai_json, mode, validation_json
             FROM analyses ORDER BY id DESC LIMIT 50",
        )
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            let rules: String = row.get(3)?;
            let ai: Option<String> = row.get(4)?;
            let validation: String = row.get(6)?;
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "createdAt": row.get::<_, String>(1)?,
                "input": row.get::<_, String>(2)?,
                "rules": serde_json::from_str::<Value>(&rules).unwrap_or(Value::Null),
                "ai": ai.and_then(|value| serde_json::from_str::<Value>(&value).ok()),
                "mode": row.get::<_, String>(5)?,
                "validationIssues": serde_json::from_str::<Value>(&validation)
                    .unwrap_or_else(|_| Value::Array(vec![]))
            }))
        })
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| DesktopError::Database(error.to_string()))
}

fn initialize_database(path: &PathBuf) -> Result<(), DesktopError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| DesktopError::Database(error.to_string()))?;
    }
    let connection = Connection::open(path)
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                input TEXT NOT NULL,
                rules_json TEXT NOT NULL,
                ai_json TEXT,
                mode TEXT NOT NULL CHECK(mode IN ('hybrid', 'rules-only')),
                validation_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS analyses_created_at_idx
                ON analyses(created_at DESC);",
        )
        .map_err(|error| DesktopError::Database(error.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("riskshield.sqlite3");
            initialize_database(&path)?;
            app.manage(DatabasePath(path));
            let bundled_codex = app
                .path()
                .resolve("codex/bin/codex.exe", BaseDirectory::Resource)?;
            app.manage(CodexState::new(bundled_codex));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            account_read,
            login_start,
            logout,
            rate_limits_read,
            codex_analyze,
            save_analysis,
            list_history
        ])
        .run(tauri::generate_context!())
        .expect("RiskShield desktop runtime failed");
}
