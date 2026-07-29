# RiskShield v0.6 Desktop Implementation Report

## Outcome

RiskShield now has a Tauri 2 desktop client that uses Codex App Server as its
primary analyzer, Gemma 4 through the user's Google AI Studio key as its first
fallback, and deterministic Analyzer v4 only as the final offline safety mode.
The design uses a user's normal Codex/ChatGPT authentication flow instead of a
paid Platform API key.

## Architecture

1. The Rust host starts the locally installed `codex app-server` over JSONL
   stdio and performs the required `initialize`/`initialized` handshake.
2. `account/login/start` with `chatgptDeviceCode` lets Codex own sign-in and
   credential persistence.
3. A read-only `thread/start` and schema-constrained `turn/start` produce the
   primary contextual decision without running or supplying local rules.
4. On the first invalid or unavailable Codex result, the UI asks for a Google
   AI Studio key only if one is not already stored. Rust writes it to Windows
   Credential Manager and calls Gemma 4 directly.
5. React/Vite loads reviewed `starterSkills` and runs Analyzer v4 only when
   both Codex and Gemma 4 fail.
6. Accepted results and fallback disclosures are persisted in local SQLite.

## Trust boundaries

- RiskShield does not receive or persist ChatGPT access or refresh tokens.
- The Gemma API key never enters SQLite or a configuration file; only the Rust
  host reads it back from Windows Credential Manager when fallback is required.
- The child process is local and communicates only over piped stdio.
- The model cannot edit files or execute requested work in the analysis turn.
- The UI discloses the exact engine used: Codex, Gemma 4, or Analyzer v4 rules.
- Codex CLI availability is not required for Gemma or local-rules fallback.

## Verification gates

- Desktop TypeScript production build
- Validator unit tests
- Existing v0.5 typecheck, lint, tests, and production build
- Rust `cargo check --locked` on Windows
- MSI and NSIS packaging on Windows Server 2025

The Linux GPT Work environment can execute the web and TypeScript gates.
Windows-specific Rust and installer verification is delegated to GitHub Actions.
