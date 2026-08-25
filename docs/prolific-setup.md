# Prolific setup and launch checklist

This checklist applies to study version `2026-08-25-v7` and assignment version `n30-three-versions-v1`.

## 1. Confirm the language-eligibility decision

All 38 documents imported from Google Drive `final output` are in Korean and the interface is in English. The in-study screener asks for native and comfortably used languages and screens out anyone who reports Korean. Confirm that this visual-first-impression design is consistent with the approved protocol, preregistration, public description, and analysis plan.

## 2. Suggested study copy

**Public title**

> Brief visual comparison of formatted online articles

**Study description**

> You will briefly view two differently formatted versions of the same online article and rate which visual appearance would motivate you more to continue reading. The task contains two practice trials and 114 timed comparisons in three sets of 38, with two optional breaks and one clearly labeled attention check per set. A 60-second rest is recommended at each break, but you may continue immediately. Allow approximately 20–25 minutes; the final estimate and reward should be based on a realistic pilot.

**Eligibility and device notice**

> Laptop or desktop only; no phones or tablets. Use a maximized browser window at 100% zoom and be prepared to enter full-screen mode. You must have normal or corrected-to-normal vision, pass a brief display-specific color-vision check, read creator-led newsletters/blogs or similar text publications at least weekly, and not speak Korean. Instructions are in English. No audio, camera, microphone, or download is required.

**Participant-facing data note**

> We record your Prolific participant, study, and session IDs; preference ratings and response times; display/browser information needed to assess timed presentation quality; and study-quality checks. We do not ask for your name or email address.

## 3. Prolific configuration

1. Use an external study link and enable desktop compatibility only.
2. Repeat the laptop/desktop requirement in the public description; the interface validates it again.
3. Configure custom screening and the paid `Screened out` path before publishing.
4. Create five completion paths and select the indicated processing action:
   - Successful completion → `Manually review` → `redirects.complete`
   - Screened out → fixed screen-out payment → `redirects.screenedOut`
   - Incompatible device → `Request a return` → `redirects.incompatibleDevice`
   - Instruction check not passed → `Request a return` → `redirects.failedComprehension`
   - No consent → `Request a return` → `redirects.noConsent`
5. Paste each full redirect URL, rather than only its completion code, into `study-config.js`.

Live URL:

```text
https://textenr-test.github.io/study1_interface/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

Never use `preview=1` in the live Prolific URL.

## 4. Task and quality-check behavior

- Two practice trials precede the main study.
- Main trials 1–38 form Set 1, 39–76 Set 2, and 77–114 Set 3.
- Attention checks appear after global trials 12, 50, and 88 and require +1, +3, and +1 respectively.
- Incorrect attention responses are logged, but the task remains locked until the instructed value is selected.
- A server checkpoint must confirm trials 1–38 before the first break and 1–76 before the second break.
- Each break recommends 60 seconds but may be skipped immediately. Its start, elapsed time, skip status, and acknowledgement are logged.
- Final completion requires all 114 trial indices, 38 rows in each set, all three attention checks, both acknowledged break screens, and the final event.

## 5. Create the private collector workbook

Use a fresh workbook for the v7 schema.

1. Open the private research Google Sheet.
2. Select **Extensions → Apps Script**.
3. Replace `Code.gs` with `apps-script/Code.gs`.
4. In **Project Settings → Script properties**, set:
   - `STUDY_VERSION = 2026-08-25-v7`
   - `SPREADSHEET_ID` only if the script is not bound to the target Sheet.
   - `EXPORT_FOLDER_ID` only if CSV/JSON exports should be placed in a different restricted Drive folder.
5. Run `setupStudyWorkbook()` once and authorize Spreadsheet and Drive access.
6. Confirm the function creates these tabs:
   - `Participants`
   - `Trials`
   - `TrialJSON`
   - `Events`
   - `README`
7. Confirm it creates `text-enrichment-final-log.csv` and `text-enrichment-final-log.json` in the configured restricted folder.
8. Deploy as a web app, executing as the spreadsheet owner, accessible to anyone with the deployment link.
9. Paste the `/exec` URL into `study-config.js` as `dataEndpoint` and redeploy the interface.

Each trial is written idempotently to both `Trials` and `TrialJSON`. The browser confirms both writes before removing the record from its retry queue. The CSV/JSON Drive exports refresh after every successful participant completion; an authorized researcher can run `exportStudyLogs()` for an on-demand refresh. The public web endpoint does not expose the Sheet or export files.

Slots are not released automatically. If a participant abandons an allocated slot and the protocol permits replacement, an authorized researcher may run:

```js
releaseIncompleteSlot("PROLIFIC_PID", "STUDY_ID")
```

This preserves any partial trial rows for audit, marks the participant as released, and makes the immutable slot available again. Analyze completed participants only so exactly one completion represents each slot.

## 6. Verify allocation and stimulus files

Run:

```sh
npm test
```

The allocation test must confirm:

- 30 slot files and 3,420 master rows.
- 114 trials per slot and 38 per set.
- three distinct conditions per participant-document.
- participant-condition total 19.
- document-condition total 15.
- document-condition-set total 5.
- document-condition-pair co-occurrence 6.
- participant-set-condition frequency 6 or 7.
- participant-set side balance 19/19.
- document-condition side balance 7/8 or 8/7.
- cross-set document-order constraints.

The stimulus test must confirm 38 packages, 266 complete HTML files, the `Google Drive/final output` provenance, and package hashes. Review source warnings for `P6_DOC_A`, `P13_DOC_A`, and `P13_DOC_B` before analysis.

## 7. End-to-end prelaunch checks

1. Complete fast researcher previews for slots 1, 6, 7, 12, 25, and 30.
2. Complete at least one full-duration preview without `fast=1`, including both optional break screens and both the skip and full-wait behaviors.
3. In a staging collector, verify one response appears in both `Trials` and `TrialJSON` with the same `event_id`.
4. Verify the first checkpoint reports 38/38 and the second 76/76 before the break begins.
5. Change tabs during a timed display and confirm that attempt is discarded and repeated.
6. Close and reopen the same Prolific session and confirm allocation, set position, break state, and unsent queue resume correctly.
7. Confirm final completion reports 114 trials and set counts `[38, 38, 38]`.
8. Confirm the private CSV and JSON exports contain the completed participant’s 114 rows.
9. Test all five routes: consent decline, paid eligibility/color screen-out, incompatible device return, instruction-check return, and successful completion.
10. Pilot the full study before fixing the advertised duration and reward; recheck Prolific’s current payment and screening guidance at launch time.

Keep the Sheet, exported logs, and any downloaded analysis files restricted according to the approved retention plan.
