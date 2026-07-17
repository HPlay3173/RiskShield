# RiskShield v0.2 validation report

Date: 2026-07-17 (Asia/Seoul)

## Outcome

RiskShield v0.2 meets the persistence, Analyzer regression, import-safety, severity-boundary, and simplified mobile-flow gates in the local production bundle. No Sites deployment was performed.

## Automated verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 warnings |
| `npm test` | PASS, 24 tests |
| `npm run build` | PASS, vinext production bundle |
| `git diff --check` | PASS |
| Prior Analyzer fixture | 47/47 represented; 44/44 clear cases PASS |
| Review variants | V01, V03, V04 all detected without sentence-specific exceptions |
| Generalized variants | 24/24 PASS |
| Clear false negatives | 0 |
| Clear false positives | 0 |

The fixture is `tests/fixtures/analyzer-v0.2-cases.csv`. It includes the exact prior 47 inputs and 24 variants covering paraphrases, safe negation, quotation/CTA contrast, unrelated meanings, sentence/paragraph scope, normalization, and standalone terms.

## Root-cause repairs

- D1 is authoritative. The client starts without a local starter-skill collection, reports GET failures, and changes saved UI state only after POST/PUT success. The former session-only save success path is removed.
- Unmodified bundled rules receive a revisioned data migration, while rows with a real updated timestamp are not overwritten. New samples are inserted as a set only when the database is empty.
- Finance, refund, privacy, education, and medical rules now cover reusable semantic combinations and paragraph scope where required. Original offsets remain tied to the unmodified user text.
- A reusable metalinguistic guard suppresses quoted/reporting/education/criticism contexts; it does not suppress a quoted advertising CTA solely because quotes are present.
- Unsupported declared schema versions and non-HTTP(S) URLs fail before database mutation.
- The shared severity policy now defines 70–79 as `주의` and 80–100 as `높음`; boundary tests cover 79, 80, and 82.
- Import is staged: file selection, count preview, then server apply. Merge/upsert is default; replace requires a checkbox and recomputes its own final count. D1 `batch()` applies the final skills plus severity policy atomically.

## Browser and D1 verification

The freshly built `dist` bundle was served through the Cloudflare/Vite preview so the configured local `DB` binding was active. Browser operations used the production assets rather than the development server.

1. Created a dedicated `risk_draft_20260717140320` candidate: PASS.
2. Saved it as draft only after D1 success: PASS.
3. Reloaded and found the same draft row: PASS.
4. Changed source provenance to provided and saved as reviewed: PASS.
5. Opened a second tab and observed the same D1-backed fields; a separate score persistence check retained `risk_finance_000001` at 86: PASS.
6. Analyzer loaded the reviewed test skill and returned 55 with its exact ID: PASS.
7. Saved the test skill as rejected: PASS.
8. Analyzer then returned 0 for its unique phrase: PASS.
9. Clicked all five export controls; each reported its exact file creation: PASS.
10. Re-imported the legacy two-record bundle and saw all required counts before apply: PASS.
11. Applied merge; the report confirmed 15 skills saved to D1 in one PUT/batch: PASS.
12. Reloaded; 15 skills and the rejected lifecycle row remained: PASS.
13. Q02 quotation/criticism case returned 0: PASS.
14. R02 certain-profit case returned high risk (85 in the baseline fixture; 86 after the browser persistence edit): PASS.
15. R06 no-loss case returned high risk (87 baseline; 88 with the persisted browser edit): PASS.
16. At the <=390px breakpoint the mobile screen selector was visible, the desktop nav was hidden, header height was 112px, and document width had no horizontal overflow: PASS.
17. Screen transition reset `scrollY` to 0; Analyzer title began below the sticky header. The skip link was off-screen before focus and the `:focus` reveal rule is regression-tested: PASS with one control-surface limitation noted below.

The reviewed score edit was also inspected after refresh and in a new tab: status, ID, source title, trigger/context collections, and score were preserved.

## Import verification

- Merge preview before the lifecycle test: new 0, update 0, same 0, conflict 2, skipped 2, errors 0, final 14.
- Merge application after the lifecycle test: final 15; refresh retained 15.
- Replace confirmation: unchecked button disabled; after confirmation the preview changed to replace mode, skipped 0, final 2, and the button became enabled. Destructive replace was not executed against the persistence-test database; its exact final-set behavior is covered by the automated preview test.
- Schema `99.0.0`: rejected with a specific message.
- `ftp://` source URL: rejected with a specific HTTP(S)-only message.
- Five-file export/edit/re-import round trip and Korean text preservation: automated PASS.

## Evidence

- `artifacts/v0.2/analyzer-results-v0.2.csv`
- `artifacts/v0.2/screenshots/builder-step-mobile-390.png`
- `artifacts/v0.2/screenshots/analyzer-high-risk-mobile-390.png`
- `artifacts/v0.2/screenshots/analyzer-quote-safe-mobile-390.png`
- `artifacts/v0.2/screenshots/import-preview.png`

## Remaining limitations

- The existing private Sites deployment was not changed or tested. Re-deployment is technically ready after review, but must use the separately authorized private Sites workflow and preserve the existing D1 binding. No new deployment should be created.
- Standalone `vinext start` in plain Node cannot load the `cloudflare:` module; D1 validation therefore used the production Vite/Cloudflare preview. This is expected for the configured Cloudflare binding surface.
- The in-app browser's synthetic Tab key did not move focus even though the document initially focused `BODY`. Initial skip-link concealment was verified from computed layout, and focus reveal is covered by the CSS regression assertion; a final manual keyboard Tab check in the deployed browser is still advisable.
- The browser control surface did not emit a download event for blob URLs, but all five download buttons were clicked and each UI path confirmed the exact file was created.
