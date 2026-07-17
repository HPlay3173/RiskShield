# v0.2 browser evidence

- `builder-step-mobile-390.png`: one builder stage at a time and the discoverable mobile screen selector at the <=390px breakpoint.
- `analyzer-high-risk-mobile-390.png`: prior false-negative finance wording detected as high risk on the mobile layout.
- `analyzer-quote-safe-mobile-390.png`: quoted/metalinguistic medical wording suppressed to 0.
- `import-preview.png`: separate Skill Bundle screen with new/update/same/conflict/skipped/error/final counts, merge default, and disabled replace until confirmation.

The production bundle was served through the Cloudflare/Vite preview so the local D1 binding was active. The browser also verified a reviewed skill score changed to 86, remained 86 after refresh, and appeared as 86 in a second tab with its source/status/pattern conditions intact.
