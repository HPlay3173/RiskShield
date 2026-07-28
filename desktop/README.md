# RiskShield Desktop v0.6

Windows desktop client for RiskShield Analyzer v4. It keeps deterministic rules
available offline and optionally asks Codex CLI for a second, context-aware
review through the official Codex App Server protocol.

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
