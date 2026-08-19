/*
 * Text Enrichment Reader Study — Google Apps Script data collector
 *
 * Recommended use:
 * 1. Open the study Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Replace Code.gs with this file and run setupStudyWorkbook once.
 * 4. Deploy > New deployment > Web app; execute as the owner; allow anyone with the link.
 * 5. Put the deployment URL in study-config.js as dataEndpoint.
 *
 * The public endpoint can append study records but has no public export/admin route.
 * Access to the spreadsheet remains controlled by Google Drive sharing.
 */

const SHEET_NAMES = Object.freeze({
  participants: "Participants",
  trials: "Trials",
  events: "Events",
  readme: "README"
});

const HEADERS = Object.freeze({
  Participants: [
    "participant_id", "session_id", "study_id", "participant_slot", "cohort", "cohort_position",
    "status", "consented_at", "started_at", "completed_at", "last_seen_at", "completed_trials",
    "attention_failures", "eligibility_json", "color_test_json", "comprehension_json", "device_json",
    "state_json", "final_event_id", "study_version"
  ],
  Trials: [
    "event_id", "participant_id", "session_id", "study_id", "participant_slot", "cohort",
    "cohort_position", "doc_id", "source_document_id", "stimulus_validation_status", "condition_id",
    "enriched_file", "analysis_degree", "visual_coverage", "target_coverage", "retained_factor_count",
    "baseline_side", "enriched_side", "assignment_slot", "trial_order", "randomization_seed",
    "spatial_rating", "normalized_enriched_rating", "response_time_ms", "planned_fixation_ms",
    "planned_exposure_ms", "actual_exposure_ms", "preload_ms", "attempt_count", "stimulus_scale",
    "source_viewport_width", "source_viewport_height", "fullscreen", "display_info_json", "responded_at",
    "study_version"
  ],
  Events: [
    "event_id", "participant_id", "session_id", "study_id", "participant_slot", "event_type",
    "event_timestamp", "completed_trials", "detail_json", "study_version"
  ],
  README: ["Text Enrichment Reader Study — Data Dictionary", "Value"]
});

function setupStudyWorkbook() {
  const spreadsheet = getSpreadsheet_();
  Object.keys(HEADERS).forEach(function(name) {
    const sheet = getOrCreateSheet_(spreadsheet, name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    }
    sheet.setFrozenRows(1);
    const header = sheet.getRange(1, 1, 1, HEADERS[name].length);
    header.setFontWeight("bold").setBackground("#202020").setFontColor("#ffffff");
    sheet.setHiddenGridlines(true);
  });
  const readme = spreadsheet.getSheetByName(SHEET_NAMES.readme);
  if (readme.getLastRow() <= 1) {
    readme.getRange(2, 1, 10, 2).setValues([
      ["Purpose", "Raw pseudonymous study records. One participant per Participants row; one analyzed response per Trials row; quality and lifecycle records in Events."],
      ["Participant identifiers", "Prolific participant, study, and session IDs only; do not add direct identifiers."],
      ["Rating direction", "normalized_enriched_rating: −3 means enriched much less preferred, 0 no difference, +3 enriched much more preferred."],
      ["Trial balance", "30 completed slots × 38 trials = 1,140 trial rows; 228 document-condition pairs × 5 ratings."],
      ["Attention policy", "Two explicit checks require +1 then +3. Incorrect attempts are logged; only the instructed response advances the study."],
      ["Screen-out timing", "Eligibility, device, color-vision, and comprehension paths occur before participant-slot allocation."],
      ["Stimulus warnings", "P6_DOC_A, P13_DOC_A, and P13_DOC_B have source-pipeline validation_status=warning and must be reviewed before analysis."],
      ["Spreadsheet access", "Keep this file restricted to authorized research personnel."],
      ["Collector setup", "Run setupStudyWorkbook, deploy as a web app, and paste the deployment URL into study-config.js."],
      ["Generated", new Date().toISOString()]
    ]);
  }
  spreadsheet.getSheets().forEach(function(sheet) {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    sheet.autoResizeColumns(1, lastColumn);
  });
  return { spreadsheetId: spreadsheet.getId(), url: spreadsheet.getUrl() };
}

function doGet(e) {
  try {
    const action = String(e.parameter.action || "health");
    let result;
    if (action === "health") {
      result = { ok: true, service: "text-enrichment-reader-study", timestamp: new Date().toISOString() };
    } else if (action === "reserve") {
      result = reserveSlot_(e.parameter);
    } else if (action === "confirm") {
      result = confirmEvent_(e.parameter);
    } else {
      result = { ok: false, error: "Unsupported action." };
    }
    return output_(result, e.parameter.callback);
  } catch (error) {
    return output_({ ok: false, error: String(error && error.message || error) }, e.parameter.callback);
  }
}

function doPost(e) {
  try {
    const raw = e.parameter.payload || (e.postData && e.postData.contents) || "";
    if (!raw || raw.length > 350000) throw new Error("Invalid or oversized payload.");
    const payload = JSON.parse(raw);
    const result = storePayload_(payload);
    return output_(result, "");
  } catch (error) {
    return output_({ ok: false, error: String(error && error.message || error) }, "");
  }
}

function reserveSlot_(parameters) {
  const identity = validateIdentity_(parameters);
  verifyStudyVersion_(parameters.study_version);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getSpreadsheet_();
    const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.participants);
    ensureHeaders_(sheet, HEADERS.Participants);
    const table = readTable_(sheet);
    const existing = table.rows.find(function(row) {
      return row.participant_id === identity.participantId && row.study_id === identity.studyId;
    });
    if (existing) {
      if (existing.session_id !== identity.sessionId) {
        return { ok: false, error: "The Prolific session does not match the existing allocation." };
      }
      updateParticipantFields_(sheet, existing._rowNumber, {
        last_seen_at: new Date().toISOString(),
        study_version: parameters.study_version
      });
      return {
        ok: true,
        existing: true,
        slot: Number(existing.participant_slot),
        status: existing.status,
        state: existing.state_json || ""
      };
    }

    const maxSlots = Number(PropertiesService.getScriptProperties().getProperty("MAX_SLOTS") || "30");
    const activeStatuses = new Set(["eligible", "in_progress", "ready_to_submit", "complete", "failed_attention", "upload_error"]);
    const activeRows = table.rows.filter(function(row) {
      return row.study_version === parameters.study_version && activeStatuses.has(String(row.status));
    });
    const usedSlots = new Set(activeRows.map(function(row) { return Number(row.participant_slot); }).filter(Boolean));
    let slot = null;
    for (let candidate = 1; candidate <= maxSlots; candidate += 1) {
      if (!usedSlots.has(candidate)) {
        slot = candidate;
        break;
      }
    }

    if (!slot) {
      const staleCutoff = Date.now() - 2 * 60 * 60 * 1000;
      const stale = activeRows
        .filter(function(row) {
          return row.status !== "complete"
            && row.status !== "failed_attention"
            && Date.parse(row.last_seen_at || row.started_at || 0) < staleCutoff;
        })
        .sort(function(a, b) {
          return Date.parse(a.last_seen_at || 0) - Date.parse(b.last_seen_at || 0);
        })[0];
      if (stale) {
        slot = Number(stale.participant_slot);
        updateParticipantFields_(sheet, stale._rowNumber, {
          participant_slot: "",
          status: "stale_released",
          last_seen_at: new Date().toISOString()
        });
      }
    }

    if (!slot) return { ok: false, error: "All 30 study slots are currently allocated." };
    const cohort = Math.floor((slot - 1) / 6);
    const cohortPosition = (slot - 1) % 6;
    const row = Object.fromEntries(HEADERS.Participants.map(function(header) { return [header, ""]; }));
    Object.assign(row, {
      participant_id: identity.participantId,
      session_id: identity.sessionId,
      study_id: identity.studyId,
      participant_slot: slot,
      cohort: cohort,
      cohort_position: cohortPosition,
      status: "eligible",
      last_seen_at: new Date().toISOString(),
      completed_trials: 0,
      attention_failures: 0,
      state_json: "",
      study_version: parameters.study_version
    });
    appendObjectRow_(sheet, HEADERS.Participants, row);
    return { ok: true, existing: false, slot: slot, status: "eligible", state: "" };
  } finally {
    lock.releaseLock();
  }
}

function confirmEvent_(parameters) {
  const identity = validateIdentity_(parameters);
  verifyStudyVersion_(parameters.study_version);
  const eventId = safeIdentifier_(parameters.event_id, "event_id");
  const sheet = getOrCreateSheet_(getSpreadsheet_(), SHEET_NAMES.events);
  ensureHeaders_(sheet, HEADERS.Events);
  const table = readTable_(sheet);
  const match = table.rows.find(function(row) {
    return row.event_id === eventId
      && row.participant_id === identity.participantId
      && row.study_id === identity.studyId
      && row.session_id === identity.sessionId;
  });
  return { ok: true, confirmed: Boolean(match), eventId: eventId };
}

function storePayload_(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Payload must be an object.");
  const participant = payload.participant || {};
  const identity = validateIdentity_({
    participant_id: participant.participantId,
    study_id: participant.studyId,
    session_id: participant.sessionId
  });
  verifyStudyVersion_(payload.studyVersion);
  const allowedKinds = new Set(["snapshot", "trial", "event", "final", "screenout"]);
  if (!allowedKinds.has(payload.kind)) throw new Error("Unsupported payload kind.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getSpreadsheet_();
    const participantSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.participants);
    ensureHeaders_(participantSheet, HEADERS.Participants);
    let participantTable = readTable_(participantSheet);
    let participantRow = participantTable.rows.find(function(row) {
      return row.participant_id === identity.participantId && row.study_id === identity.studyId;
    });
    if (!participantRow) {
      const blank = Object.fromEntries(HEADERS.Participants.map(function(header) { return [header, ""]; }));
      Object.assign(blank, {
        participant_id: identity.participantId,
        session_id: identity.sessionId,
        study_id: identity.studyId,
        participant_slot: participant.slot || "",
        cohort: participant.cohort ?? "",
        cohort_position: participant.cohortPosition ?? "",
        status: payload.kind === "screenout" ? "screened_out" : "unallocated",
        last_seen_at: new Date().toISOString(),
        study_version: payload.studyVersion
      });
      appendObjectRow_(participantSheet, HEADERS.Participants, blank);
      participantTable = readTable_(participantSheet);
      participantRow = participantTable.rows[participantTable.rows.length - 1];
    }
    if (participantRow.session_id !== identity.sessionId) throw new Error("Session mismatch.");

    const summary = payload.participantSummary || {};
    const update = {
      participant_slot: participant.slot ?? participantRow.participant_slot,
      cohort: participant.cohort ?? participantRow.cohort,
      cohort_position: participant.cohortPosition ?? participantRow.cohort_position,
      status: payload.outcome || summary.status || participantRow.status,
      consented_at: summary.consentedAt || participantRow.consented_at,
      started_at: summary.startedAt || participantRow.started_at,
      completed_at: summary.completedAt || participantRow.completed_at,
      last_seen_at: summary.lastSeenAt || new Date().toISOString(),
      completed_trials: summary.completedTrials ?? participantRow.completed_trials,
      attention_failures: summary.attentionFailures ?? participantRow.attention_failures,
      eligibility_json: jsonCell_(summary.eligibility),
      color_test_json: jsonCell_(summary.colorTest),
      comprehension_json: jsonCell_(summary.comprehension),
      device_json: jsonCell_(summary.device),
      state_json: jsonCell_(payload.resumeState),
      study_version: payload.studyVersion
    };
    if (payload.kind === "final") {
      update.status = payload.outcome || "complete";
      update.completed_at = summary.completedAt || new Date().toISOString();
      update.final_event_id = payload.finalEventId || "";
    }
    if (payload.kind === "screenout") update.status = payload.outcome || "screened_out";
    updateParticipantFields_(participantSheet, participantRow._rowNumber, update);

    if (payload.kind === "trial") appendTrial_(spreadsheet, payload, identity);
    if (payload.kind === "event") appendEvent_(spreadsheet, payload.event || {}, payload, identity);
    if (payload.kind === "screenout") {
      appendEvent_(spreadsheet, {
        eventId: payload.finalEventId || eventIdFromPayload_(payload, "screenout"),
        type: "screenout",
        timestamp: new Date().toISOString(),
        detail: { reason: payload.reason || "", outcome: payload.outcome || "screened_out" }
      }, payload, identity);
    }
    if (payload.kind === "final") {
      appendEvent_(spreadsheet, {
        eventId: payload.finalEventId,
        type: "final",
        timestamp: summary.completedAt || new Date().toISOString(),
        detail: payload.summary || {}
      }, payload, identity);
    }
    return { ok: true, kind: payload.kind };
  } finally {
    lock.releaseLock();
  }
}

function appendTrial_(spreadsheet, payload, identity) {
  const record = payload.record || {};
  const eventId = safeIdentifier_(record.eventId, "trial event_id");
  const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.trials);
  ensureHeaders_(sheet, HEADERS.Trials);
  if (eventExists_(sheet, eventId)) return;
  const row = {
    event_id: eventId,
    participant_id: identity.participantId,
    session_id: identity.sessionId,
    study_id: identity.studyId,
    participant_slot: record.participantSlot,
    cohort: record.cohort,
    cohort_position: record.cohortPosition,
    doc_id: record.docId,
    source_document_id: record.sourceDocumentId,
    stimulus_validation_status: record.validationStatus,
    condition_id: record.conditionId,
    enriched_file: record.enrichedFile,
    analysis_degree: record.analysisDegree,
    visual_coverage: record.visualCoverage,
    target_coverage: record.targetCoverage,
    retained_factor_count: record.retainedFactorCount,
    baseline_side: record.baselineSide,
    enriched_side: record.enrichedSide,
    assignment_slot: record.assignmentSlot,
    trial_order: record.trialOrder,
    randomization_seed: record.randomizationSeed,
    spatial_rating: record.spatialRating,
    normalized_enriched_rating: record.rating,
    response_time_ms: record.responseTimeMs,
    planned_fixation_ms: record.plannedFixationMs,
    planned_exposure_ms: record.plannedExposureMs,
    actual_exposure_ms: record.actualExposureMs,
    preload_ms: record.preloadMs,
    attempt_count: record.attemptCount,
    stimulus_scale: record.stimulusScale,
    source_viewport_width: record.sourceViewportWidth,
    source_viewport_height: record.sourceViewportHeight,
    fullscreen: record.fullscreen,
    display_info_json: jsonCell_(record.displayInfo),
    responded_at: record.respondedAt,
    study_version: payload.studyVersion
  };
  appendObjectRow_(sheet, HEADERS.Trials, row);
}

function appendEvent_(spreadsheet, event, payload, identity) {
  const eventId = safeIdentifier_(event.eventId || eventIdFromPayload_(payload, event.type || "event"), "event_id");
  const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.events);
  ensureHeaders_(sheet, HEADERS.Events);
  if (eventExists_(sheet, eventId)) return;
  appendObjectRow_(sheet, HEADERS.Events, {
    event_id: eventId,
    participant_id: identity.participantId,
    session_id: identity.sessionId,
    study_id: identity.studyId,
    participant_slot: payload.participant && payload.participant.slot,
    event_type: event.type || payload.kind,
    event_timestamp: event.timestamp || event.answeredAt || new Date().toISOString(),
    completed_trials: payload.participantSummary && payload.participantSummary.completedTrials,
    detail_json: jsonCell_(event.detail || event),
    study_version: payload.studyVersion
  });
}

function eventIdFromPayload_(payload, label) {
  const participant = payload.participant || {};
  const value = [payload.studyVersion, participant.sessionId, label, new Date().getTime()].join(":");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  const hex = digest.map(function(byte) { return (byte + 256).toString(16).slice(-2); }).join("");
  return label + "_" + hex.slice(0, 16);
}

function eventExists_(sheet, eventId) {
  if (sheet.getLastRow() < 2) return false;
  const match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(eventId)
    .matchEntireCell(true)
    .findNext();
  return Boolean(match);
}

function getSpreadsheet_() {
  const propertyId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (propertyId) return SpreadsheetApp.openById(propertyId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("Bind this script to the study spreadsheet or set SPREADSHEET_ID.");
  return active;
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function readTable_(sheet) {
  if (sheet.getLastRow() < 1) return { headers: [], rows: [] };
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const rows = values.slice(1).map(function(valuesRow, index) {
    const row = { _rowNumber: index + 2 };
    headers.forEach(function(header, column) { row[header] = valuesRow[column]; });
    return row;
  });
  return { headers: headers, rows: rows };
}

function appendObjectRow_(sheet, headers, object) {
  const values = headers.map(function(header) { return safeCell_(object[header]); });
  sheet.appendRow(values);
}

function updateParticipantFields_(sheet, rowNumber, fields) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  Object.keys(fields).forEach(function(key) {
    const column = headers.indexOf(key);
    if (column >= 0 && fields[key] !== undefined) {
      sheet.getRange(rowNumber, column + 1).setValue(safeCell_(fields[key]));
    }
  });
}

function validateIdentity_(parameters) {
  return {
    participantId: safeIdentifier_(parameters.participant_id, "participant_id"),
    studyId: safeIdentifier_(parameters.study_id, "study_id"),
    sessionId: safeIdentifier_(parameters.session_id, "session_id")
  };
}

function safeIdentifier_(value, field) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(text)) throw new Error("Invalid " + field + ".");
  return text;
}

function verifyStudyVersion_(version) {
  const text = safeIdentifier_(version, "study_version");
  const expected = PropertiesService.getScriptProperties().getProperty("STUDY_VERSION");
  if (expected && expected !== text) throw new Error("Study version mismatch.");
}

function jsonCell_(value) {
  if (value === undefined || value === null) return "";
  const text = JSON.stringify(value);
  return text.length > 49000 ? JSON.stringify({ truncated: true, prefix: text.slice(0, 48000) }) : text;
}

function safeCell_(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" && /^[=+@]/.test(value)) return "'" + value;
  return value;
}

function output_(object, callback) {
  const json = JSON.stringify(object).replace(/</g, "\\u003c");
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
