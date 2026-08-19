import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = process.argv[2];
if (!outputDir) throw new Error("Provide an output directory.");
await fs.mkdir(outputDir, { recursive: true });

const participantHeaders = [
  "participant_id", "session_id", "study_id", "participant_slot", "cohort", "cohort_position",
  "status", "consented_at", "started_at", "completed_at", "last_seen_at", "completed_trials",
  "attention_failures", "eligibility_json", "color_test_json", "comprehension_json", "device_json",
  "state_json", "final_event_id", "study_version"
];
const trialHeaders = [
  "event_id", "participant_id", "session_id", "study_id", "participant_slot", "cohort",
  "cohort_position", "doc_id", "source_document_id", "stimulus_validation_status", "condition_id",
  "enriched_file", "analysis_degree", "visual_coverage", "target_coverage", "retained_factor_count",
  "baseline_side", "enriched_side", "assignment_slot", "trial_order", "randomization_seed",
  "spatial_rating", "normalized_enriched_rating", "response_time_ms", "planned_fixation_ms",
  "planned_exposure_ms", "actual_exposure_ms", "preload_ms", "attempt_count", "stimulus_scale",
  "source_viewport_width", "source_viewport_height", "fullscreen", "display_info_json", "responded_at",
  "study_version"
];
const eventHeaders = [
  "event_id", "participant_id", "session_id", "study_id", "participant_slot", "event_type",
  "event_timestamp", "completed_trials", "detail_json", "study_version"
];
const readmeRows = [
  ["Text Enrichment Reader Study — Data Dictionary", "Value"],
  ["Purpose", "Raw pseudonymous study records. Participants, analyzed trial responses, and lifecycle/quality events are separated by tab."],
  ["Expected final trials", 1140],
  ["Expected unique document-condition pairs", 228],
  ["Expected ratings per pair", 5],
  ["Rating direction", "normalized_enriched_rating: −3 = enriched much less preferred; 0 = no difference; +3 = enriched much more preferred."],
  ["Participant identifiers", "Prolific participant, study, and session IDs only. Do not add direct identifiers."],
  ["Attention checks", "Two explicit checks require +1 then +3. Incorrect attempts are logged; only the instructed response advances the study."],
  ["Source warnings", "Review P6_DOC_A, P13_DOC_A, and P13_DOC_B before analysis; source pipeline status is warning."],
  ["Collector", "Deploy apps-script/Code.gs as a bound Google Apps Script web app."],
  ["Access", "Keep spreadsheet sharing restricted to authorized research personnel."],
  ["Study version", "2026-08-19-v4"]
];

const workbook = Workbook.create();
const readme = workbook.worksheets.add("README");
const participants = workbook.worksheets.add("Participants");
const trials = workbook.worksheets.add("Trials");
const events = workbook.worksheets.add("Events");

function styleHeader(sheet, rangeAddress) {
  const range = sheet.getRange(rangeAddress);
  range.format = {
    fill: "#202020",
    font: { bold: true, color: "#FFFFFF", size: 10 },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "left",
    borders: { preset: "outside", style: "thin", color: "#202020" }
  };
  range.format.rowHeightPx = 44;
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
}

readme.getRange("A1:B12").values = readmeRows;
styleHeader(readme, "A1:B1");
readme.getRange("A2:A12").format.font = { bold: true, color: "#252525" };
readme.getRange("A2:B12").format = {
  verticalAlignment: "top",
  wrapText: true,
  borders: {
    insideHorizontal: { style: "thin", color: "#E1E1E1" },
    bottom: { style: "thin", color: "#E1E1E1" }
  }
};
readme.getRange("A1:A12").format.columnWidthPx = 245;
readme.getRange("B1:B12").format.columnWidthPx = 680;
readme.getRange("A2:B12").format.rowHeightPx = 42;

participants.getRangeByIndexes(0, 0, 1, participantHeaders.length).values = [participantHeaders];
styleHeader(participants, "A1:T1");
participants.getRange("A1:T1").format.columnWidthPx = 145;
participants.getRange("N1:R1").format.columnWidthPx = 230;

trials.getRangeByIndexes(0, 0, 1, trialHeaders.length).values = [trialHeaders];
styleHeader(trials, "A1:AJ1");
trials.getRange("A1:AJ1").format.columnWidthPx = 138;
trials.getRange("U1:U1").format.columnWidthPx = 240;
trials.getRange("AH1:AH1").format.columnWidthPx = 240;

events.getRangeByIndexes(0, 0, 1, eventHeaders.length).values = [eventHeaders];
styleHeader(events, "A1:J1");
events.getRange("A1:J1").format.columnWidthPx = 155;
events.getRange("I1:I1").format.columnWidthPx = 320;

const inspect = await workbook.inspect({
  kind: "sheet,table",
  include: "id,name,values",
  tableMaxRows: 12,
  tableMaxCols: 12,
  maxChars: 8000
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan"
});
console.log(errors.ndjson);

for (const [sheetName, range] of [
  ["README", "A1:B12"],
  ["Participants", "A1:T1"],
  ["Trials", "A1:AJ1"],
  ["Events", "A1:J1"]
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(
    path.join(outputDir, sheetName.toLowerCase() + ".png"),
    new Uint8Array(await preview.arrayBuffer())
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "text-enrichment-reader-study-data.xlsx");
await output.save(outputPath);
console.log(JSON.stringify({ outputPath }));
