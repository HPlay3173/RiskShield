# RiskShield Desktop v0.8.0

Windows desktop client for RiskShield. Codex CLI is the primary analysis
engine, Gemma 4 through the user's free Google AI Studio API key is the network fallback, and
deterministic Analyzer v4 rules are used only when both AI engines are
unavailable.

## Why a desktop client

The web application cannot reuse a user's interactive Codex allowance as if it
were a general-purpose API key. The desktop client instead runs `codex
app-server` on the user's own machine and lets Codex own the ChatGPT device-code
login, token storage, token refresh, and rate-limit reporting.

No OpenAI Platform API key is accepted by the RiskShield UI. No ChatGPT token is
read or stored by RiskShield. The app-server process owns its credential state.

## Requirements

- Windows 10/11
- Node.js 22.13+ and Rust stable only when building from source

The Windows installers bundle the complete official Codex CLI 0.145.0 Windows
x64 runtime. At startup RiskShield checks `RISKSHIELD_CODEX_BIN`, then an
existing `codex.exe` on `PATH`, and finally its bundled runtime. End users do
not need Node.js, npm, a separate CLI install, or an OpenAI Platform API key.

## Local checks

```powershell
npm ci
npm test
npm run build
npm run tauri build
```

`scripts/prepare-codex-runtime.ps1` downloads the pinned official Windows x64
package from npm before a release build. The Windows CI workflow then publishes
MSI and NSIS installers containing that runtime as workflow artifacts.

## Safety behavior

- Codex runs first and receives only the source text through a read-only,
  no-approval turn with a strict JSON output schema.
- If Codex is signed out, limited, unavailable, or invalid, the desktop calls
  Gemma 4 directly through the Google Generative Language API.
- The Gemma key prompt appears only after an actual Codex failure. Saving it
  writes it directly to Windows Credential Manager and resumes the interrupted
  analysis; the key is never added to RiskShield history or configuration files.
- Choosing `이번에는 규칙만` skips key setup for that analysis.
- Analyzer v4 runs only when both Codex and Gemma 4 are unavailable or invalid.
- Every evidence quote must be an exact substring of the source.
- Rewrites containing a number absent from the source are rejected.
- A valid Codex or Gemma result is never capped or overridden by local rules.
- Codex and Gemma independently return a 0–100 risk score, a primary context
  judgment, and a structured review report in the same analysis call.
- When local rules are the final fallback, the existing Analyzer v4 score,
  speech-act classification, reasons, recommendation, and safe rewrite are
  presented through the same result layout without pretending that an AI
  context review occurred.
- Analysis history is stored locally in SQLite under the operating system's
  application-data directory.

## Analysis views and local administration

- `균형 분석`, `광고·주장`, `문맥 우선` change only the order in which an
  unchanged set of findings is shown. They never change the underlying
  judgment or re-run a model.
- The local administrator screen stores only last-resort fallback rules.
  Administrators can add an Analyzer-missed expression, edit/enable/disable or
  delete it, and import/export CSV.
- Administrator rules stay in the local SQLite database and are evaluated only
  after both Codex and Gemma 4 are unavailable.
