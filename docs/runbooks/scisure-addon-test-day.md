# SciSure add-on test day (sandbox, staging backend)

Scope: install add-on 0.4.0 on the **sandbox** SciSure installation, pointed at `https://staging.greenchemistry.ai`, and exercise the review flow on a **disposable** record. Nothing here touches production.

## 0. Known state (read-only checks on 2026-10-26)

| Item | State |
|---|---|
| Staging DB `qqyzyezwlzvckjtggoes`, migration `20261001210000_scisure_private_workspace` | **NOT applied** |
| Staging DB, migration `20261001220000_scisure_owned_workspace_recovery` | **NOT applied** |
| Staging DB, migration `20261026000000_talk_decisions_and_procedure_proposals` (chat approve/reject and proposals; not tracked by the verifier) | **NOT applied** |
| `scripts/verify-scisure-staging.py` | Fails today on both counts: the two missing migrations, and a verifier limitation. It hashes only the first statement of each applied migration, so the six multi-statement migrations `20261001070000`-`20261001140000` show as differing even though their text is split, not changed. |
| Add-on bundle | Builds with `npm run package` (section 2). Never uploaded to a real hub. |
| Web app on staging | `main` includes the popup review UI, owner recovery route and saved review page. |

Without the missing migrations the popup cannot load a workspace and chat approve/reject and proposals fail.

## 1. Staging prerequisites (do these first)

1. **Apply the three migrations to staging only.** Target the project ref explicitly. The root Supabase CLI link is production, so never use an implicit `db push`. Then run `python3 scripts/verify-scisure-staging.py` (read-only). Expect it to report only the known multi-statement verifier limitation, not missing versions.
2. **Allowed origins.** Vercel staging env `SCISURE_ALLOWED_ORIGINS` and `NEXT_PUBLIC_SCISURE_ALLOWED_ORIGINS` must both contain the exact origin of the SciSure sandbox page the add-on runs on. `NEXT_PUBLIC_*` is baked in at build time, so redeploy after changing it. This could not be checked from here.
3. **Vercel Deployment Protection.** `staging.greenchemistry.ai` redirects to Vercel SSO. A scientist's popup only works if their browser is signed in to Vercel, or protection is relaxed for this test. Decide beforehand; the failure looks like a login page inside the popup.
4. **Worker running.** The scheduler runs the worker once a minute with container start-up on top, so analysis takes minutes, not seconds:
   `CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.11 gcloud --project greenchemistry-ai scheduler jobs describe gcai-scisure-worker-1m --location us-central1` (state must be ENABLED).
5. **A staging GreenChemistry.ai account**, signed in at `https://staging.greenchemistry.ai` in the same browser profile you use for SciSure. Guest/unverified-email access is intentionally unavailable.

## 2. Build and install the add-on

```bash
cd integrations/scisure-addon
npm ci && npm test && npm run check
npm run package
```

`npm run package` refuses to build unless: `add-on.js` parses; `package.json` and the exported version agree; the defaults ship the bridge **disabled** with staging origins and a 3,900,000 ms (65 min) timeout; `config.example.json` equals `defaultConfiguration.json`; and the schema has no Supplies/catalog/order settings. Output in `dist/` (git-ignored):

- `scisure-greenchemistry-addon-0.4.0.zip`: all files, for handing over or archiving.
- `scisure-greenchemistry-addon-0.4.0/add-on.js`: the single file the hub's individual upload takes.
- `MANIFEST.json` and `SHA256SUMS`: record the sha256 of what you uploaded.

Install (sandbox installation only; never bulk upgrade or production publish):

1. Developer hub, sandbox installation, **Upgrade, individual upload**: upload `add-on.js`. Keep rootVar `greenchemistry_ai`.
2. Paste `configurationSchema.json` into the hub's configuration schema separately (re-uploading JS does not replace it).
3. Set the per-instance configuration from `defaultConfiguration.json`, then set `gcaiBridge.enabled` to `true` for the sandbox only.
4. Save and hard-refresh the sandbox tab. Confirm: version 0.4.0, only "Review for GCai" buttons, 65-minute timeout, no Supplies option.

## 3. Test script (disposable sandbox records only)

Record IDs, timestamps and a screenshot for each step.

| # | Action | Expect |
|---|---|---|
| 1 | Open an experiment, choose Review for GCai, submit | Popup opens, "Signed-in connection ready", then "Source admitted. Analysis is queued" |
| 2 | Wait for the worker | "Analysis completed. Review every finding...", findings listed (warnings and hypotheses included) |
| 3 | Try to prepare a draft before deciding everything | Button disabled with a count of remaining findings |
| 4 | Decide every finding, prepare the draft | Draft text, limitations and private evidence appendix shown; accepted warnings read "Acknowledge" and never change the text |
| 5 | Click Ask on a finding; open the Evidence Atlas | Chat opens, scoped to that finding; Atlas shows with no app navigation bar |
| 6 | Tick the confirmation, click Create | SciSure prompts for a destination study; afterwards the popup says Saved with a record ID |
| 7 | Open that record in SciSure | New experiment with the reviewed draft and the evidence appendix; original unchanged |
| 8 | Click Create again with the same draft | "Previously verified writeback; no new mutation" (no second record) |
| 9 | Repeat with a protocol, then a single protocol step | New **protocol**, labeled selected-content copy; original unchanged |
| 10 | Close the popup, open `/analyze/<id>/scisure` while signed in | Saved review loads read-only with your decisions; chemistry is not re-run |
| 11 | Sign in as a second user and open that URL | Not available |

## 4. Stop conditions

- **Uncertain** result: do not retry. Note the record ID shown, check SciSure manually, and reconcile before any new attempt. The add-on holds one writeback lock per SciSure tab session.
- **Update existing** is always "Not supported" by design.
- Anything touching a non-sandbox record or a production origin: stop.

## 5. Not covered

Live import and create readback have never run against the real SciSure API, so failures at steps 6-9 may be API-shape issues rather than regressions. Category/permission behaviour for protocols and two-user role checks are also untested. Fixture-based evidence (`tests/scisure-connect.spec.ts`, add-on `npm run test:browser`) does not substitute for these.
