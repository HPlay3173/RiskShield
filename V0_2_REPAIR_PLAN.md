# RiskShield v0.2 repair plan

## Objective

Repair the v0.1 persistence, Analyzer, import, severity-policy, and mobile-accessibility defects without changing the Analyzer v4 contract, schema `2.0.0`, human-review workflow, or the existing private deployment.

## Evidence and root causes

- Persistence: `.openai/hosting.json` binds Cloudflare D1 as `DB`, and `/api/skills` already reads and writes that database. The client nevertheless seeded its own state before the server response and treated a failed save as a session-only success. D1 must be the only authoritative state.
- Import: the bundle reader parsed files and immediately replaced React state. It had no merge preview, conflict policy, replacement confirmation, atomic server apply, or durable-save check.
- Analyzer: the eight reviewed starter rules were narrowly phrased. Their coverage missed generic profit claims, loss-absence claims, generalized refund promises, personal-data processing, paraphrased education claims, and paragraph-level medical/privacy/finance combinations. The engine also lacked a reusable metalinguistic quotation guard.
- Contract validation: migration normalized every incoming schema version to `2.0.0`, so an unsupported `99.0.0` declaration could pass. Source URLs were not constrained to HTTP(S).
- Severity: the shared policy labeled scores 80–84 as `주의`, while the validation contract treats 80+ as `높음`.
- UI: the builder is already a six-stage wizard, but import still exposes selection, guidance, bundle import, and results together. Mobile navigation relies on a horizontally scrolling row without an explicit menu affordance.

## Boundaries

- Edit only application source, database schema/migration, tests/fixtures, README, and the requested `artifacts/v0.2` deliverables.
- Do not deploy, change the existing hosted project/domain, add an LLM/API dependency, commit the three 10,000-row dictionaries, or modify the supplied ZIP/DOCX/CSV source files.
- Preserve reviewed-only production analysis, Dominant Risk scoring, `all_of`/`any_of`/`none_of`, sentence/paragraph scope, `maxDistance`, and human review.

## Implementation sequence

1. Make D1 authoritative: loading/error states, no client fallback, save only after durable response, and exact status/source/conditions/score/ID round-trip.
2. Add deterministic import preview (`new`, `update`, `same`, `conflict`, `skipped`, `errors`, `final`), merge/upsert default, confirmed replace, and atomic D1 application.
3. Extend reusable reviewed rules and conservative context guards; reject unsupported schema versions and non-HTTP(S) URLs; align the shared 80+ severity threshold.
4. Simplify import into `파일 선택 → 미리보기 → 적용`, keep one builder stage visible at a time, and add a discoverable mobile menu with reliable focus/scroll behavior.
5. Convert all 47 prior Analyzer cases plus at least 20 generalized variants into automated fixtures. Require all 44 clear cases to pass; permit V01/V03/V04 as review/detected variants.
6. Run typecheck, lint, automated tests, production build, `git diff --check`, and production-build browser validation. Save the exact CSV result and screenshots under `artifacts/v0.2`.

## Acceptance gates

- A failed GET/POST/import never creates a local success state.
- Refresh and a second tab return identical durable fields from D1.
- Invalid schema `99.0.0` and non-HTTP(S) source URLs are rejected before apply.
- Import preview counts match the applied final set; replace requires explicit confirmation; failure leaves the prior database unchanged.
- Clear Analyzer fixture cases are 44/44; three review variants remain explicitly classified; 20+ generalized variants pass.
- The 390px UI exposes every top-level destination and no sticky header obscures the focused stage.
