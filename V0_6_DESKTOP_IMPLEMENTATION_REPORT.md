# RiskShield v0.6 Desktop Implementation Report

## Outcome

RiskShield now has a Tauri 2 desktop client that combines the existing
deterministic Analyzer v4 with an optional Codex App Server review. The design
uses a user's normal Codex/ChatGPT authentication flow instead of a paid
Platform API key.

## Architecture

1. React/Vite loads the reviewed `starterSkills` and `analyzeText` implementation
   directly from the existing RiskShield engine.
2. The Rust host starts the locally installed `codex app-server` over JSONL
   stdio and performs the required `initialize`/`initialized` handshake.
3. `account/login/start` with `chatgptDeviceCode` lets Codex own sign-in and
   credential persistence.
4. A read-only `thread/start` and schema-constrained `turn/start` produce the
   contextual review.
5. The frontend validates evidence and rewrite claims before accepting the AI
   result. Invalid or unavailable AI output falls back to rules-only mode.
6. Accepted results and fallback disclosures are persisted in local SQLite.

## Trust boundaries

- RiskShield does not receive or persist ChatGPT access or refresh tokens.
- The child process is local and communicates only over piped stdio.
- The model cannot edit files or execute requested work in the analysis turn.
- The UI always discloses whether a result is hybrid or rules-only.
- Codex CLI availability is an explicit runtime prerequisite for hybrid mode.

## Verification gates

- Desktop TypeScript production build
- Validator unit tests
- Existing v0.5 typecheck, lint, tests, and production build
- Rust `cargo check --locked` on Windows
- MSI and NSIS packaging on Windows Server 2025

The Linux GPT Work environment can execute the web and TypeScript gates.
Windows-specific Rust and installer verification is delegated to GitHub Actions.
