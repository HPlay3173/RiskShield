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
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{path::BaseDirectory, Manager, State};
use thiserror::Error;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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
    #[error("Gemma 4 대체 분석 오류: {0}")]
    Gemma(String),
    #[error("GEMMA_KEY_MISSING: Gemma API 키가 저장되어 있지 않습니다.")]
    GemmaKeyMissing,
    #[error("GEMMA_AUTH_INVALID: 저장한 Gemma API 키가 유효하지 않습니다.")]
    GemmaAuthInvalid,
    #[error("Windows 자격 증명 관리자 오류: {0}")]
    Credential(String),
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
        let mut command = Command::new(binary);
        command
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
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
    rules: Option<Value>,
    ai: Option<Value>,
    mode: String,
    focus: String,
    engine: String,
    validation_issues: Vec<Value>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FallbackRuleInput {
    id: Option<String>,
    expression: String,
    category: String,
    severity: String,
    reason: String,
    enabled: bool,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FallbackRule {
    id: String,
    expression: String,
    category: String,
    severity: String,
    reason: String,
    enabled: bool,
    source: String,
    created_at: String,
    updated_at: String,
}

static FALLBACK_RULE_COUNTER: AtomicU64 = AtomicU64::new(1);

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
            "riskScore": { "type": "number", "minimum": 0, "maximum": 100 },
            "contextJudgment": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "direct_claim", "quotation", "criticism", "warning",
                            "reporting", "educational", "conditional", "unclear"
                        ]
                    },
                    "explanation": { "type": "string" }
                },
                "required": ["type", "explanation"],
                "additionalProperties": false
            },
            "reviewReport": {
                "type": "object",
                "properties": {
                    "verdict": { "type": "string" },
                    "keyIssues": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "potentialRisks": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "recommendation": { "type": "string" },
                    "rewrite": { "type": ["string", "null"] }
                },
                "required": ["verdict", "keyIssues", "potentialRisks", "recommendation", "rewrite"],
                "additionalProperties": false
            },
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
        "required": [
            "summary", "riskScore", "contextJudgment", "reviewReport", "findings", "model"
        ],
        "additionalProperties": false
    })
}

fn gemma_analysis_schema() -> Value {
    json!({
        "type": "OBJECT",
        "properties": {
            "summary": { "type": "STRING" },
            "riskScore": { "type": "NUMBER", "minimum": 0, "maximum": 100 },
            "contextJudgment": {
                "type": "OBJECT",
                "properties": {
                    "type": {
                        "type": "STRING",
                        "enum": [
                            "direct_claim", "quotation", "criticism", "warning",
                            "reporting", "educational", "conditional", "unclear"
                        ]
                    },
                    "explanation": { "type": "STRING" }
                },
                "required": ["type", "explanation"]
            },
            "reviewReport": {
                "type": "OBJECT",
                "properties": {
                    "verdict": { "type": "STRING" },
                    "keyIssues": {
                        "type": "ARRAY",
                        "items": { "type": "STRING" }
                    },
                    "potentialRisks": {
                        "type": "ARRAY",
                        "items": { "type": "STRING" }
                    },
                    "recommendation": { "type": "STRING" },
                    "rewrite": { "type": "STRING", "nullable": true }
                },
                "required": ["verdict", "keyIssues", "potentialRisks", "recommendation", "rewrite"]
            },
            "findings": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "category": { "type": "STRING" },
                        "severity": { "type": "STRING", "enum": ["low", "review", "high"] },
                        "evidence": { "type": "STRING" },
                        "explanation": { "type": "STRING" },
                        "rewrite": { "type": "STRING", "nullable": true },
                        "confidence": { "type": "NUMBER", "minimum": 0, "maximum": 1 }
                    },
                    "required": ["category", "severity", "evidence", "explanation", "rewrite", "confidence"]
                }
            }
        },
        "required": ["summary", "riskScore", "contextJudgment", "reviewReport", "findings"]
    })
}

const CODEX_SOL_MODEL: &str = "gpt-5.6-sol";
const CODEX_TERRA_MODEL: &str = "gpt-5.6-terra";

fn codex_model_for_account(account_result: &Value) -> &'static str {
    let account = account_result.get("account");
    let account_type = account
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str);
    let plan_type = account
        .and_then(|value| value.get("planType"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();

    if account_type == Some("chatgpt") && matches!(plan_type.as_str(), "free" | "go") {
        CODEX_TERRA_MODEL
    } else {
        CODEX_SOL_MODEL
    }
}

fn is_model_availability_error(error: &DesktopError) -> bool {
    let DesktopError::Rpc(detail) = error else {
        return false;
    };
    let detail = detail.to_ascii_lowercase();
    detail.contains("model")
        && [
            "not available",
            "unavailable",
            "not supported",
            "unsupported",
            "does not exist",
            "access",
            "permission",
            "current plan",
        ]
        .iter()
        .any(|reason| detail.contains(reason))
}

fn start_codex_thread(
    server: &mut AppServer,
    model: &str,
) -> Result<Value, DesktopError> {
    server.request(
        "thread/start",
        json!({
            "model": model,
            "ephemeral": true,
            "approvalPolicy": "never",
            "sandboxPolicy": { "type": "readOnly" },
            "serviceName": "riskshield-desktop"
        }),
    )
}

#[tauri::command]
fn codex_analyze(
    input: String,
    state: State<'_, CodexState>,
) -> Result<Value, DesktopError> {
    state.with(|server| {
        let account = server.request("account/read", json!({ "refreshToken": false }))?;
        let mut requested_model = codex_model_for_account(&account);
        let thread = match start_codex_thread(server, requested_model) {
            Ok(thread) => thread,
            Err(error)
                if requested_model == CODEX_SOL_MODEL
                    && is_model_availability_error(&error) =>
            {
                requested_model = CODEX_TERRA_MODEL;
                start_codex_thread(server, requested_model)?
            }
            Err(error) => return Err(error),
        };
        let thread_id = string_at(&thread, &["thread", "id"])
            .ok_or_else(|| DesktopError::Protocol("thread id 누락".into()))?;
        let model = string_at(&thread, &["thread", "model"])
            .or_else(|| string_at(&thread, &["model"]))
            .unwrap_or_else(|| requested_model.to_owned());
        let prompt = format!(
            "당신은 RiskShield의 주 판정기입니다. 도구를 사용하지 마세요. \
             원문에 실제로 존재하는 연속 문자열만 evidence로 인용하세요. \
             원문에 없는 수치, 조건, 사실을 rewrite에 추가하지 마세요. \
             비판·경고·인용·보도 문맥은 위험을 직접 지지하는 표현과 구분하세요. \
             riskScore는 원문 전체의 논란·오해 위험을 0~100 정수로 직접 산정하세요. \
             0은 직접 위험 미탐지, 1~69는 낮음·추가 검토, 70~79는 주의, 80~100은 높은 위험입니다. \
             contextJudgment에는 직접 주장·인용·비판·경고·보도·교육·조건부·불명확 중 주된 문맥과 이유를 쓰세요. \
             reviewReport에는 종합 판정, 핵심 문제, 예상 위험, 수정 권고와 가능한 대체 문구를 작성하세요. \
             findings가 비어 있어도 riskScore, contextJudgment, reviewReport는 반드시 작성하세요. \
             규칙 결과는 참고 신호이지 정답이나 등급 상한선이 아닙니다. 규칙에 없는 위험도 독립적으로 판정하세요. \
             특히 518, 5/18, 5.18, 5·18은 평범한 숫자나 날짜처럼 보이지만 5·18 민주화운동을 가리키는 \
             은닉 신호일 수 있습니다. 일정·예약·교육·보도처럼 사용 이유가 명확한지는 제외 맥락으로 보고, \
             광고·행사·할인·슬로건에 이유 없이 튀어나오면 숨겨진 역사 신호 가능성을 검토하세요. \
             5·18 날짜와 '탱크데이', '탱크 데이', '책상에 탁' 같은 표현이 판촉 문맥에서 결합되면 \
             계엄군 탱크 진입과 고문치사 사건을 연상시키는 중대한 브랜드·역사 윤리 위험으로 평가하세요. \
             단, 해당 논란을 비판·보도·교육·사과하는 글 자체를 위험 홍보로 오판하지 마세요.\n\n원문:\n{}",
            input
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
            object.insert("model".into(), Value::String(model));
        }
        Ok(parsed)
    })
}

const GEMMA_CREDENTIAL_SERVICE: &str = "RiskShield Desktop";
const GEMMA_CREDENTIAL_ACCOUNT: &str = "Google AI Studio Gemma API Key";
const GEMMA_MODEL: &str = "gemma-4-26b-a4b-it";

#[cfg(windows)]
fn stored_gemma_key() -> Result<Option<String>, DesktopError> {
    let entry = keyring::Entry::new(GEMMA_CREDENTIAL_SERVICE, GEMMA_CREDENTIAL_ACCOUNT)
        .map_err(|error| DesktopError::Credential(error.to_string()))?;
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(DesktopError::Credential(error.to_string())),
    }
}

#[cfg(not(windows))]
fn stored_gemma_key() -> Result<Option<String>, DesktopError> {
    Ok(env::var("RISKSHIELD_GEMMA_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty()))
}

#[cfg(windows)]
fn store_gemma_key(api_key: &str) -> Result<(), DesktopError> {
    let entry = keyring::Entry::new(GEMMA_CREDENTIAL_SERVICE, GEMMA_CREDENTIAL_ACCOUNT)
        .map_err(|error| DesktopError::Credential(error.to_string()))?;
    entry
        .set_password(api_key)
        .map_err(|error| DesktopError::Credential(error.to_string()))
}

#[cfg(not(windows))]
fn store_gemma_key(_api_key: &str) -> Result<(), DesktopError> {
    Err(DesktopError::Credential(
        "API 키 영구 저장은 Windows 앱에서만 지원됩니다.".into(),
    ))
}

#[cfg(windows)]
fn remove_gemma_key() -> Result<(), DesktopError> {
    let entry = keyring::Entry::new(GEMMA_CREDENTIAL_SERVICE, GEMMA_CREDENTIAL_ACCOUNT)
        .map_err(|error| DesktopError::Credential(error.to_string()))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(DesktopError::Credential(error.to_string())),
    }
}

#[cfg(not(windows))]
fn remove_gemma_key() -> Result<(), DesktopError> {
    Ok(())
}

fn gemma_analyze_with_key(input: String, api_key: String) -> Result<Value, DesktopError> {
    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{GEMMA_MODEL}:generateContent"
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| DesktopError::Gemma(error.to_string()))?;
    let response = client
        .post(endpoint)
        .header("x-goog-api-key", api_key)
        .json(&json!({
            "systemInstruction": {
                "parts": [{
                    "text": "당신은 RiskShield의 보조 판정기입니다. 반드시 submit_riskshield_analysis 함수를 정확히 한 번 호출하세요. 원문에 실제로 존재하는 연속 문자열만 evidence로 인용하고, 원문에 없는 수치·조건·사실을 rewrite에 추가하지 마세요. 비판·경고·인용·보도 문맥은 위험을 직접 지지하는 표현과 구분하세요. riskScore는 원문 전체의 논란·오해 위험을 0~100 정수로 직접 산정하세요. 0은 직접 위험 미탐지, 1~69는 낮음·추가 검토, 70~79는 주의, 80~100은 높은 위험입니다. contextJudgment에는 주된 문맥 유형과 이유를 쓰고 reviewReport에는 종합 판정, 핵심 문제, 예상 위험, 수정 권고와 가능한 대체 문구를 작성하세요. findings가 비어 있어도 이 세 필드는 반드시 작성하세요. 518, 5/18, 5.18, 5·18은 5·18 민주화운동을 가리키는 은닉 신호일 수 있습니다. 일정·예약·교육·보도처럼 사용 이유가 명확하면 안전 맥락으로 보고, 광고·행사·할인·슬로건에 이유 없이 등장하면 숨겨진 역사 신호 가능성을 검토하세요. 5·18 날짜와 탱크데이·탱크 데이·책상에 탁 같은 표현이 판촉 문맥에서 결합되면 중대한 브랜드·역사 윤리 위험으로 평가하되, 해당 논란을 비판·보도·교육·사과하는 글 자체는 위험 홍보로 오판하지 마세요."
                }]
            },
            "contents": [{
                "role": "user",
                "parts": [{ "text": input }]
            }],
            "tools": [{
                "functionDeclarations": [{
                    "name": "submit_riskshield_analysis",
                    "description": "RiskShield 분석 결과를 제출합니다.",
                    "parameters": gemma_analysis_schema()
                }]
            }],
            "toolConfig": {
                "functionCallingConfig": {
                    "mode": "ANY",
                    "allowedFunctionNames": ["submit_riskshield_analysis"]
                }
            },
            "generationConfig": {
                "temperature": 0,
                "thinkingConfig": { "thinkingLevel": "minimal" }
            }
        }))
        .send()
        .map_err(|error| DesktopError::Gemma(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let status_code = status.as_u16();
        let detail = response.text().unwrap_or_default();
        if status_code == 401
            || status_code == 403
            || detail.contains("API_KEY_INVALID")
            || detail.contains("API key not valid")
        {
            let _ = remove_gemma_key();
            return Err(DesktopError::GemmaAuthInvalid);
        }
        return Err(DesktopError::Gemma(format!(
            "Google API가 HTTP {} 상태를 반환했습니다.",
            status_code
        )));
    }
    let response = response
        .json::<Value>()
        .map_err(|error| DesktopError::Gemma(format!("응답 파싱 실패: {error}")))?;
    let mut arguments = response
        .get("candidates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|candidate| candidate.get("content"))
        .filter_map(|content| content.get("parts"))
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|part| part.get("functionCall"))
        .find(|call| call.get("name").and_then(Value::as_str) == Some("submit_riskshield_analysis"))
        .and_then(|call| call.get("args"))
        .cloned()
        .ok_or_else(|| DesktopError::Gemma("구조화된 함수 호출 응답이 없습니다.".into()))?;
    let object = arguments
        .as_object_mut()
        .ok_or_else(|| DesktopError::Gemma("함수 호출 인자가 객체가 아닙니다.".into()))?;
    object.insert(
        "model".into(),
        Value::String(
            response
                .get("modelVersion")
                .and_then(Value::as_str)
                .unwrap_or(GEMMA_MODEL)
                .to_owned(),
        ),
    );
    Ok(arguments)
}

#[tauri::command]
fn gemma_key_save_and_analyze(api_key: String, input: String) -> Result<Value, DesktopError> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(DesktopError::Credential("빈 API 키는 저장할 수 없습니다.".into()));
    }
    store_gemma_key(api_key)?;
    gemma_analyze_with_key(input, api_key.to_owned())
}

#[tauri::command]
fn gemma_analyze(input: String) -> Result<Value, DesktopError> {
    let api_key = stored_gemma_key()?.ok_or(DesktopError::GemmaKeyMissing)?;
    gemma_analyze_with_key(input, api_key)
}

fn connection(path: &DatabasePath) -> Result<Connection, DesktopError> {
    Connection::open(&path.0).map_err(|error| DesktopError::Database(error.to_string()))
}

fn validate_fallback_rule(rule: &FallbackRuleInput) -> Result<(), DesktopError> {
    if rule.expression.trim().is_empty() {
        return Err(DesktopError::Database("규칙 표현이 비어 있습니다.".into()));
    }
    if rule.expression.chars().count() > 240 {
        return Err(DesktopError::Database(
            "규칙 표현은 240자 이하여야 합니다.".into(),
        ));
    }
    if !matches!(rule.severity.as_str(), "low" | "review" | "high") {
        return Err(DesktopError::Database(
            "규칙 위험도는 low, review, high 중 하나여야 합니다.".into(),
        ));
    }
    if !matches!(rule.source.as_str(), "missed" | "csv") {
        return Err(DesktopError::Database(
            "규칙 출처는 missed 또는 csv여야 합니다.".into(),
        ));
    }
    Ok(())
}

fn read_fallback_rule(connection: &Connection, id: &str) -> Result<FallbackRule, DesktopError> {
    connection
        .query_row(
            "SELECT id, expression, category, severity, reason, enabled, source, created_at, updated_at
             FROM fallback_rules WHERE id = ?1",
            [id],
            |row| {
                Ok(FallbackRule {
                    id: row.get(0)?,
                    expression: row.get(1)?,
                    category: row.get(2)?,
                    severity: row.get(3)?,
                    reason: row.get(4)?,
                    enabled: row.get::<_, i64>(5)? != 0,
                    source: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .map_err(|error| DesktopError::Database(error.to_string()))
}

fn upsert_fallback_rule(
    connection: &Connection,
    rule: FallbackRuleInput,
) -> Result<FallbackRule, DesktopError> {
    validate_fallback_rule(&rule)?;
    let expression = rule.expression.trim();
    let category = if rule.category.trim().is_empty() {
        "관리자 보완 규칙"
    } else {
        rule.category.trim()
    };
    let reason = if rule.reason.trim().is_empty() {
        "관리자가 추가한 로컬 보완 규칙"
    } else {
        rule.reason.trim()
    };
    let existing_id = connection
        .query_row(
            "SELECT id FROM fallback_rules WHERE expression = ?1 COLLATE NOCASE LIMIT 1",
            [expression],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let id = rule.id.or(existing_id).unwrap_or_else(|| {
        format!(
            "fallback-{}-{}",
            chrono::Utc::now().timestamp_micros(),
            FALLBACK_RULE_COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    });
    let now = chrono::Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO fallback_rules
             (id, expression, category, severity, reason, enabled, source, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(id) DO UPDATE SET
               expression = excluded.expression,
               category = excluded.category,
               severity = excluded.severity,
               reason = excluded.reason,
               enabled = excluded.enabled,
               source = excluded.source,
               updated_at = excluded.updated_at",
            params![
                id,
                expression,
                category,
                rule.severity,
                reason,
                if rule.enabled { 1_i64 } else { 0_i64 },
                rule.source,
                now,
            ],
        )
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    read_fallback_rule(connection, &id)
}

#[tauri::command]
fn fallback_rules_list(db: State<'_, DatabasePath>) -> Result<Vec<FallbackRule>, DesktopError> {
    let connection = connection(&db)?;
    let mut statement = connection
        .prepare(
            "SELECT id, expression, category, severity, reason, enabled, source, created_at, updated_at
             FROM fallback_rules ORDER BY updated_at DESC, expression ASC",
        )
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            Ok(FallbackRule {
                id: row.get(0)?,
                expression: row.get(1)?,
                category: row.get(2)?,
                severity: row.get(3)?,
                reason: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
                source: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| DesktopError::Database(error.to_string()))
}

#[tauri::command]
fn fallback_rule_upsert(
    rule: FallbackRuleInput,
    db: State<'_, DatabasePath>,
) -> Result<FallbackRule, DesktopError> {
    let connection = connection(&db)?;
    upsert_fallback_rule(&connection, rule)
}

#[tauri::command]
fn fallback_rules_import(
    rules: Vec<FallbackRuleInput>,
    db: State<'_, DatabasePath>,
) -> Result<usize, DesktopError> {
    if rules.len() > 5_000 {
        return Err(DesktopError::Database(
            "한 번에 가져올 수 있는 규칙은 최대 5,000개입니다.".into(),
        ));
    }
    let mut connection = connection(&db)?;
    let transaction = connection
        .transaction()
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    for rule in rules.iter().cloned() {
        upsert_fallback_rule(&transaction, rule)?;
    }
    transaction
        .commit()
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    Ok(rules.len())
}

#[tauri::command]
fn fallback_rule_delete(id: String, db: State<'_, DatabasePath>) -> Result<(), DesktopError> {
    let connection = connection(&db)?;
    connection
        .execute("DELETE FROM fallback_rules WHERE id = ?1", params![id])
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    Ok(())
}

#[tauri::command]
fn save_analysis(payload: SaveInput, db: State<'_, DatabasePath>) -> Result<i64, DesktopError> {
    let connection = connection(&db)?;
    connection
        .execute(
            "INSERT INTO analyses
             (created_at, input, rules_json, ai_json, mode, focus, engine, validation_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                chrono::Utc::now().to_rfc3339(),
                payload.input,
                payload.rules.unwrap_or(Value::Null).to_string(),
                payload.ai.map(|value| value.to_string()),
                payload.mode,
                payload.focus,
                payload.engine,
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
            "SELECT id, created_at, input, rules_json, ai_json, mode, focus, engine, validation_json
             FROM analyses ORDER BY id DESC LIMIT 50",
        )
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    let rows = statement
        .query_map([], |row| {
            let rules: String = row.get(3)?;
            let ai: Option<String> = row.get(4)?;
            let validation: String = row.get(8)?;
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "createdAt": row.get::<_, String>(1)?,
                "input": row.get::<_, String>(2)?,
                "rules": serde_json::from_str::<Value>(&rules).unwrap_or(Value::Null),
                "ai": ai.and_then(|value| serde_json::from_str::<Value>(&value).ok()),
                "mode": row.get::<_, String>(5)?,
                "focus": row.get::<_, String>(6)?,
                "engine": row.get::<_, String>(7)?,
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
                focus TEXT NOT NULL DEFAULT 'balanced',
                engine TEXT NOT NULL DEFAULT 'rules',
                validation_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS analyses_created_at_idx
                ON analyses(created_at DESC);
            CREATE TABLE IF NOT EXISTS fallback_rules (
                id TEXT PRIMARY KEY,
                expression TEXT NOT NULL COLLATE NOCASE UNIQUE,
                category TEXT NOT NULL,
                severity TEXT NOT NULL CHECK(severity IN ('low', 'review', 'high')),
                reason TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                source TEXT NOT NULL CHECK(source IN ('missed', 'csv')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS fallback_rules_updated_at_idx
                ON fallback_rules(updated_at DESC);",
        )
        .map_err(|error| DesktopError::Database(error.to_string()))?;
    let has_engine = {
        let mut statement = connection
            .prepare("PRAGMA table_info(analyses)")
            .map_err(|error| DesktopError::Database(error.to_string()))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| DesktopError::Database(error.to_string()))?;
        columns
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| DesktopError::Database(error.to_string()))?
            .iter()
            .any(|column| column == "engine")
    };
    if !has_engine {
        connection
            .execute(
                "ALTER TABLE analyses ADD COLUMN engine TEXT NOT NULL DEFAULT 'rules'",
                [],
            )
            .map_err(|error| DesktopError::Database(error.to_string()))?;
    }
    let has_focus = {
        let mut statement = connection
            .prepare("PRAGMA table_info(analyses)")
            .map_err(|error| DesktopError::Database(error.to_string()))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| DesktopError::Database(error.to_string()))?;
        columns
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| DesktopError::Database(error.to_string()))?
            .iter()
            .any(|column| column == "focus")
    };
    if !has_focus {
        connection
            .execute(
                "ALTER TABLE analyses ADD COLUMN focus TEXT NOT NULL DEFAULT 'balanced'",
                [],
            )
            .map_err(|error| DesktopError::Database(error.to_string()))?;
    }
    Ok(())
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
            gemma_key_save_and_analyze,
            gemma_analyze,
            fallback_rules_list,
            fallback_rule_upsert,
            fallback_rules_import,
            fallback_rule_delete,
            save_analysis,
            list_history
        ])
        .run(tauri::generate_context!())
        .expect("RiskShield desktop runtime failed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_and_go_accounts_use_terra() {
        for plan in ["free", "go"] {
            let account = json!({
                "account": {
                    "type": "chatgpt",
                    "planType": plan
                }
            });
            assert_eq!(codex_model_for_account(&account), CODEX_TERRA_MODEL);
        }
    }

    #[test]
    fn paid_chatgpt_accounts_use_sol() {
        for plan in ["plus", "pro", "business", "enterprise", "edu"] {
            let account = json!({
                "account": {
                    "type": "chatgpt",
                    "planType": plan
                }
            });
            assert_eq!(codex_model_for_account(&account), CODEX_SOL_MODEL);
        }
    }

    #[test]
    fn only_model_access_errors_trigger_terra_retry() {
        assert!(is_model_availability_error(&DesktopError::Rpc(
            "Model gpt-5.6-sol is not available for your current plan".into(),
        )));
        assert!(!is_model_availability_error(&DesktopError::Rpc(
            "Rate limit reached".into(),
        )));
        assert!(!is_model_availability_error(&DesktopError::Timeout));
    }
}
