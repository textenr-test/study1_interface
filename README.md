# Text Enrichment Reader Study

Static GitHub Pages experiment for a 30-reader Prolific study.

## What is implemented

- English participant interface with consent, device validation, eligibility screening, a display-specific color-vision check, and two-attempt comprehension checks.
- Two practice trials, 38 timed main trials, a halfway break, and explicit attention checks after trials 12 and 26.
- 750 ms fixation and 500 ms simultaneous exposure. Both document versions use the same scale, retain the source 900 px layout, and are preloaded before timing begins. The interface measures each rendered document, fits to the longer member of the pair, and excludes only unused bottom whitespace so no text is clipped.
- Repeated 6-condition Latin-square assignment across 30 server-assigned slots. Each document-condition pair is rated by exactly five readers when slots 1–30 complete.
- Per-participant randomized trial order, exact left/right balancing, normalized −3…+3 enriched-version ratings, local recovery, timing interruption detection, and detailed quality logs.
- Google Apps Script collector for atomic slot allocation, Google Sheet logging, idempotent trial/event records, final-save confirmation, and cross-device resume for the same Prolific session.

## Important launch status

The page is safe to deploy for researcher preview, but live Prolific entry is intentionally blocked until these values are filled in study-config.js:

1. dataEndpoint — deployed Google Apps Script web-app URL.
2. redirects.complete
3. redirects.screenedOut
4. redirects.noConsent
5. redirects.failedAttention

The Drive batch_output excerpts contain Korean text in all 38 documents, while the interface is English. The current eligibility flow intentionally screens out participants who report Korean as a native or comfortably used language. This supports a visual-first-impression task without Korean-language comprehension, but the choice must remain aligned with the approved protocol and analysis plan.

## Local checks

    npm test
    python3 -m http.server 4173

Preview:

    http://localhost:4173/?preview=1&slot=1

Fast flow check:

    http://localhost:4173/?preview=1&slot=1&fast=1

Preview mode never writes remote data, never redirects to Prolific, and does not expose a downloadable participant log.

## Repository structure

- index.html, styles.css, app.js — participant interface.
- assignment.js — deterministic study allocation.
- study-config.js — study manifest, timings, endpoint, and completion paths.
- stimuli/ — one self-contained JSON package per document plus index.json.
- apps-script/ — Google Sheet collector.
- docs/prolific-setup.md — launch checklist and participant-facing copy.
- tests/ and scripts/ — balance and stimulus integrity checks.

## Privacy and deployment notes

- Do not place OAuth credentials, Google API keys, researcher tokens, or private admin secrets in this public repository.
- The Google Sheet should remain restricted to authorized researchers. The Apps Script exposes append/resume/confirmation operations only; it has no public export endpoint.
- Full trial and event records are retained in the researcher-only Google Sheet, including fitted content height and removed bottom-whitespace metrics for stimulus QA. Participant recovery storage excludes completed response and event histories; only progress and any temporarily unsent queue are retained locally.
- GitHub Pages is public. Anyone who knows the URL can download the stimuli. Use a private study host instead if stimulus embargo or access control is required.
- Prolific IDs are pseudonymous identifiers. Keep exports restricted and follow the approved retention and deletion plan.

See docs/prolific-setup.md before launching.
