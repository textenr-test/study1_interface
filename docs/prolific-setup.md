# Prolific setup and launch checklist

This checklist is written for the August 2026 Prolific study builder and should be rechecked immediately before publication.

## 1. Confirm the stimulus-language eligibility decision

All 38 current Drive batch_output documents are in Korean and the interface is English. The current eligibility flow asks for native and comfortably used languages, then screens out anyone who reports Korean. This is intended to isolate immediate visual impressions from Korean-language comprehension. Confirm that this exclusion is consistent with the approved protocol, preregistration, Prolific description, and analysis plan before launch.

## 2. Suggested Prolific study details

**Public title**

> Brief visual comparison of formatted online articles

**Study description**

> In this study, you will briefly view two differently formatted versions of the same online article excerpt and rate which version makes you more willing to continue reading based on its immediate visual appearance. The task includes a short eligibility section, two practice trials, 38 timed comparisons, a short halfway break, and two clearly labeled attention checks. It takes about 10–12 minutes.

**Eligibility and device notice**

> Laptop or desktop only; no phones or tablets. Use a maximized browser window at 100% zoom and be prepared to enter full-screen mode. You must have normal or corrected-to-normal vision, pass a brief display-specific color-vision check, read creator-led newsletters/blogs or similar text publications at least weekly, and not speak Korean. Study instructions are in English. No audio, camera, microphone, or download is required.

**Participant-facing data note**

> We record your Prolific participant, study, and session IDs; preference ratings and response times; display/browser information needed to assess timed presentation quality; and study-quality checks. We do not ask for your name or email address.

## 3. Audience and compatibility settings

1. Set **Data collection type** to **External Study Link**.
2. Select **Desktop** only in device compatibility.
3. Repeat the desktop-only requirement in the public description. Prolific's device setting is an indicator and the experiment validates it again at the start.
4. Use Prolific prescreeners where exact matches exist. Keep the in-study custom questions for the study-specific weekly-reading and language-exclusion criteria.
5. Enable **Custom screening** and budget screen-out slots separately from the 30 completed places.

## 4. Study URL and parameters

Use:

    https://textenr-test.github.io/study1_interface/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}

The interface requires and records all three parameters:

- PROLIFIC_PID
- STUDY_ID
- SESSION_ID

Do not use the researcher-preview query parameters in the live Prolific link.

## 5. Completion paths

Create the paths below in Prolific **before** publishing, then paste each complete redirect URL into study-config.js.

| Interface key | Prolific completion path | Recommended action |
| --- | --- | --- |
| redirects.complete | Successful completion | Approve according to the study's review setting |
| redirects.screenedOut | Screened out | Built-in custom screen-out payment |
| redirects.noConsent | No consent | Request a return; never reject for no consent |
| redirects.failedAttention | Failed attention checks | Configure according to the preregistered review/exclusion plan |

The two attention checks are explicit instructed-response items after trials 12 and 26. The interface sends a participant to the failed-attention path only after **both** checks are failed. A single failure is logged but does not change the normal completion path.

Comprehension checks appear before the main task, stay on the same page as the instructions, use multiple-choice responses, and allow two attempts. Participants who fail twice are sent to the early screen-out path; they are not rejected.

## 6. Google Sheet collector

1. Open the study Google Sheet.
2. Select **Extensions → Apps Script**.
3. Replace Code.gs with apps-script/Code.gs.
4. Run setupStudyWorkbook() once and approve the requested spreadsheet permissions.
5. In **Project Settings → Script properties**, add:
   - STUDY_VERSION = 2026-08-19-v1
   - MAX_SLOTS = 30
   - SPREADSHEET_ID only if the script is not bound to the target spreadsheet.
6. Select **Deploy → New deployment → Web app**.
7. Execute as the spreadsheet owner and allow access to anyone with the deployment link.
8. Copy the /exec deployment URL into study-config.js as dataEndpoint.
9. Keep spreadsheet sharing restricted to authorized research personnel.

The collector creates/uses four tabs:

- Participants — one row per attempted participant and resumable state.
- Trials — one row per analyzed main-trial response.
- Events — attention checks, timing interruptions, connectivity, screen-out, and final-save records.
- README — data dictionary and analysis notes.

The native Google Sheet can be downloaded as .xlsx or per-tab CSV by the manager.

## 7. Payment and timing

Run a realistic pilot before fixing the duration and reward.

- Current estimated duration: **10–12 minutes**.
- Prolific's current absolute minimum is **£6 / $8 per hour**.
- Prolific currently recommends at least **£9 / $12 per hour**.
- At the recommended rate, 12 minutes corresponds to **£1.80 / $2.40**.
- For a custom screener lasting one minute or less, Prolific's current minimum fixed screen-out reward is **£0.10 / $0.14**.

Use the pilot's median time to revise the estimate and reward before the main launch.

## 8. Required prelaunch tests

1. Run npm test.
2. Complete researcher previews for slots 1, 6, 7, 12, 25, and 30.
3. Confirm the Google Sheet records:
   - URL parameters,
   - one participant allocation,
   - trial response and normalized rating,
   - actual exposure duration,
   - display scale and viewport,
   - attention results,
   - final event.
4. Interrupt one trial by changing tabs; confirm the attempt is discarded and repeated.
5. Close and reopen with the same Prolific parameters; confirm resume.
6. Test each completion path in a Prolific preview.
7. Pilot with **5–10 participants**, as Prolific recommends, before opening 30 main-study places.
8. Review the three source-pipeline warnings before analysis: P6_DOC_A, P13_DOC_A, and P13_DOC_B.

## 9. Official Prolific references

- URL parameters and completion redirects: https://researcher-help.prolific.com/en/articles/445178-what-survey-experimental-software-is-compatible-with-prolific
- In-study screening and completion paths: https://researcher-help.prolific.com/en/articles/445165-can-i-screen-participants-within-my-study
- Custom screening and screen-out payments: https://researcher-help.prolific.com/en/articles/445155-how-to-use-custom-screening-to-recruit-specific-participants
- Attention and comprehension checks: https://researcher-help.prolific.com/en/articles/445153-prolific-s-attention-and-comprehension-check-policy
- Device restrictions: https://researcher-help.prolific.com/en/articles/445149-how-do-i-restrict-participation-to-certain-devices
- Pilot studies: https://researcher-help.prolific.com/en/articles/445167-how-do-i-run-a-pilot-study-on-prolific
- Participant payment: https://researcher-help.prolific.com/en/articles/445266-how-much-should-i-pay-participants
