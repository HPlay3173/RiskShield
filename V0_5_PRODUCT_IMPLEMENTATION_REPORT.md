# RiskShield v0.5 Alpha Implementation Report

## Release identity

- Product branch: `riskshield/v0.5-product`
- Product status: alpha
- Canonical product structure: public Analyzer at `/` plus unified management console at `/manage/*`
- GitHub is the source of truth for the current commit, PR checks, and review state.
- Sites is the source of truth for the saved version number and production deployment state.

## Implemented product boundary

- `/` and `POST /api/analyze` are public.
- `/manage/*` and management APIs require server-side manager authorization.
- Legacy `/admin/*`, `/dev/*`, and `/owner/*` routes remain compatibility redirects or protected aliases.
- `/api/skills` is retired with HTTP 410.
- Public responses do not include the complete skill corpus, matcher patterns, internal skill IDs, prompts, provider configuration, or raw model JSON.

## Analyzer and scoring

- Analyzer v4 remains the compatibility matcher kernel and loads reviewed skills only.
- Google Gemma is an optional, strictly validated context interpreter with rules-only fallback.
- Scoring Policy 3.1 uses one final decision engine.
- Stable `riskFamily` identifiers replace category-label string inference for managed skills.
- AI confidence caps are enforced at 0.65, 0.80, and 0.90 boundaries.
- Rule evidence strengthens AI evidence only when both point to the same evidence span or claim clause.
- Cross-category score bonuses are not used.
- AI-only high scores remain `review` until same-claim rule evidence exists.
- The 0–100 value remains explicitly experimental and is not presented as a calibrated probability.

## Dataset lineage and training

- CSV bytes are parsed and hashed on the server.
- Immutable originals are stored in R2 with SHA-256 content-addressed keys.
- D1 Dataset Versions record object key, SHA-256, byte size, row count, headers, and keyword mapping.
- Training reads the selected Dataset Version from R2 and revalidates its bytes and metadata.
- Historical Dataset Versions can be selected and replayed; training no longer compares them with the dataset's latest version.
- Dataset registration never activates a skill.
- Cleaner, dedupe/grouping, lexical similarity, optional LLM drafts, generated tests, and review-candidate persistence are implemented; unconfigured semantic/vector and feedback stages remain explicitly unavailable.

## Candidate workflow and retention

- Public submissions enter the candidate review repository and never become active automatically.
- `approve_with_edits` persists the edited draft.
- `merge` creates a revision proposal instead of silently changing an active skill.
- Approved candidates create draft skills, not reviewed/active skills.
- Public candidate submission limits use the shared D1 atomic counter rather than isolate memory.
- Public submissions carry a 30-day retention deadline, are hidden after expiry, and are physically deleted on the next submission request.

## Authentication and operations

- Production management login uses Google OIDC with PKCE, state, nonce, issuer/audience/signature checks, verified email, signed sessions, D1 role lookup, CSRF, Origin, and Fetch Metadata checks.
- Production access-code login is retired with HTTP 410.
- Analyzer request limits and provider budgets use D1 counters.
- Local fixtures require a non-production build, loopback host, and explicit enablement.

## Verification

The release gate is:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
git diff --check
```

Current local result: typecheck PASS, lint PASS, production build PASS, and automated tests PASS (`111/111`). GitHub Actions reruns the clean-install gate after push.

## Remaining limitations

- Score weights and thresholds are not calibrated on an external held-out dataset.
- Compatibility matcher rules still exist in code for legacy behavior; new managed skills use the portable matcher DSL and stable risk families.
- Semantic clustering, vector search, continuous collection, and feedback learning are not production backends yet.
- Candidate release and active policy deployment remain separate manual work that requires additional release controls.
- Retention cleanup is request-driven; a scheduled cleanup job is still desirable for deterministic deletion timing.
- Production quality, latency, and cost measurements require a real evaluation runner and representative dataset.

## Production

- Sites project: `appgprj_6a590e98034c8191af5393c355cbe739`
- URL: `https://riskshield-studio.horari.chatgpt.site`
- Access mode: public Analyzer; management remains application-authenticated and fail-closed.
- Exact deployed commit, Sites version, and smoke-test evidence are recorded in the GitHub PR/release handoff for each deployment.
