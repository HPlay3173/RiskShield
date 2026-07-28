# RiskShield Desktop v0.6

Windows desktop client for RiskShield Analyzer v4. It keeps deterministic rules
available offline and optionally asks the locally installed Codex CLI for a
second, context-aware review through the official Codex App Server protocol.

## Why a desktop client

The web application cannot reuse a user's interactive Codex allowance as if it
were a general-purpose API key. The desktop client instead runs `codex
app-server` on the user's own machine and lets Codex own the ChatGPT device-code
login, token storage, token refresh, and rate-limit reporting.

No OpenAI Platform API key is accepted by the RiskShield UI. No ChatGPT token is
read or stored by RiskShield. The app-server process owns its credential state.

## Requirements

- Windows 10/11
- Codex CLI available as `codex.exe` on `PATH`, or its path set in
  `RISKSHIELD_CODEX_BIN`
- Node.js 22.13+ and Rust stable only when building from source

## Local checks

```powershell
npm ci
npm test
npm run build
npm run tauri build
```

The Windows CI workflow publishes MSI and NSIS installers as workflow artifacts.

## Safety behavior

- Analyzer v4 runs first and remains available if Codex is signed out, limited,
  unavailable, or returns invalid data.
- Codex receives the source text and local rules result through a read-only,
  no-approval turn with a strict JSON output schema.
- Every evidence quote must be an exact substring of the source.
- Rewrites containing a number absent from the source are rejected.
- An AI-only `high` finding is downgraded to `review` unless an exact local rule
  hit supports it.
- Analysis history is stored locally in SQLite under the operating system's
  application-data directory.
