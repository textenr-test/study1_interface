/*
 * Text Enrichment Reader Study — Google Apps Script data collector
 *
 * 1. Bind this script to the private researcher Google Sheet.
 * 2. Run setupStudyWorkbook() once.
 * 3. Set STUDY_VERSION=2026-08-25-v7 in Script Properties.
 * 4. Deploy as a web app, executing as the owner, accessible to anyone with the link.
 * 5. Put the /exec URL in study-config.js as dataEndpoint.
 *
 * The public endpoint supports append/checkpoint operations only. It has no export or
 * read-data route. Spreadsheet and Drive-file access remain controlled by the owner.
 */

const STUDY_DESIGN = Object.freeze({
  participants: 30,
  sets: 3,
  trialsPerSet: 38,
  trialsPerParticipant: 114,
  assignmentVersion: "n30-three-versions-v1",
  assignmentSeed: "text-enrichment-reader-n30-v2",
  conditions: ["D1_derived", "D2_derived", "W_writer_optimal", "D3_derived", "D4_derived", "D5_maximal"]
});

const SHEET_NAMES = Object.freeze({
  participants: "Participants",
  trials: "Trials",
  trialJson: "TrialJSON",
  events: "Events",
  readme: "README"
});

const HEADERS = Object.freeze({
  Participants: [
    "participant_id", "session_id", "study_id", "participant_slot", "allocation_id",
    "assignment_version", "status", "consented_at", "started_at", "completed_at",
    "last_seen_at", "completed_trials", "attention_checks_passed", "eligibility_json",
    "color_test_json", "comprehension_json", "device_json", "state_json", "final_event_id",
    "study_version"
  ],
  Trials: [
    "event_id", "participant_id", "participant_slot", "set_id", "set_trial_index",
    "global_trial_index", "document_id", "condition_id", "enriched_file", "degree_value",
    "baseline_side", "document_exposure_number", "randomization_seed", "rating", "response_time",
    "session_id", "study_id", "allocation_id", "enriched_side", "source_document_id",
    "stimulus_validation_status", "visual_coverage", "target_coverage", "retained_factor_count",
    "spatial_rating", "planned_fixation_ms", "planned_exposure_ms", "actual_exposure_ms",
    "preload_ms", "attempt_count", "stimulus_scale", "source_viewport_width",
    "source_viewport_height", "fitted_content_height", "left_content_height",
    "right_content_height", "trimmed_bottom_whitespace_px", "fullscreen", "display_info_json",
    "responded_at", "study_version", "received_at"
  ],
  TrialJSON: [
    "event_id", "participant_id", "session_id", "study_id", "global_trial_index", "record_json",
    "received_at", "study_version"
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
    ensureHeaders_(sheet, HEADERS[name]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS[name].length)
      .setFontWeight("bold")
      .setBackground("#202020")
      .setFontColor("#ffffff");
    sheet.setHiddenGridlines(true);
  });

  const readme = spreadsheet.getSheetByName(SHEET_NAMES.readme);
  if (readme.getLastRow() <= 1) {
    const rows = [
      ["Purpose", "Pseudonymous study records. One participant per Participants row; one analyzed response per Trials row; one parallel JSON record per TrialJSON row; quality and lifecycle records in Events."],
      ["Trial balance", "30 completed allocation slots × 114 trials = 3,420 rows. Each participant completes three sets of 38 and sees three distinct enriched versions of every document."],
      ["Condition balance", "Each participant sees each condition 19 times; each document-condition pair has 15 readers; each document-condition-set cell has 5 readers; each condition pair co-occurs 6 times per document."],
      ["Side balance", "Within every participant-set, D0 appears left 19 times and right 19 times. Every document-condition pair is crossed 7/8 or 8/7 across 15 readers."],
      ["Rating direction", "rating: −3 means enriched much less preferred, 0 no difference, +3 enriched much more preferred. spatial_rating is the raw left-to-right response."],
      ["Timing", "750 ms fixation, 1,000 ms simultaneous display, three attention checks (+1, +3, +1), and 60-second breaks after trials 38 and 76."],
      ["Checkpoint policy", "Trials are appended idempotently. The interface confirms each row, checks all 38/76 rows before each break, and confirms all 114 rows before completion."],
      ["Exports", "text-enrichment-final-log.csv and text-enrichment-final-log.json are created at setup and refreshed after each completed participant. Run exportStudyLogs() for an on-demand refresh."],
      ["Slot policy", "Slots are never released automatically. Use releaseIncompleteSlot() deliberately if an incomplete allocation must be reassigned; retain partial rows for audit and analyze completed slots only."],
      ["Stimulus warnings", "P6_DOC_A, P13_DOC_A, and P13_DOC_B have source-pipeline validation_status=warning and require analysis review."],
      ["Privacy", "Keep the spreadsheet and exported files restricted to authorized research personnel. The web endpoint has no public export route."],
      ["Study version", configuredStudyVersion_()]
    ];
    readme.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  spreadsheet.getSheets().forEach(function(sheet) {
    sheet.autoResizeColumns(1, Math.max(sheet.getLastColumn(), 1));
  });
  const exports = exportStudyLogs();
  return { spreadsheetId: spreadsheet.getId(), url: spreadsheet.getUrl(), exports: exports };
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
      result = confirmFinal_(e.parameter);
    } else if (action === "checkpoint") {
      result = checkpoint_(e.parameter);
    } else if (action === "confirm_record") {
      result = confirmRecord_(e.parameter);
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
    return output_(storePayload_(JSON.parse(raw)), "");
  } catch (error) {
    return output_({ ok: false, error: String(error && error.message || error) }, "");
  }
}

function reserveSlot_(parameters) {
  const identity = validateIdentity_(parameters);
  const studyVersion = verifyStudyVersion_(parameters.study_version);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getSpreadsheet_();
    const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.participants);
    ensureHeaders_(sheet, HEADERS.Participants);
    let table = readTable_(sheet);
    let existing = table.rows.find(function(row) {
      return row.participant_id === identity.participantId
        && row.study_id === identity.studyId
        && row.study_version === studyVersion;
    });
    if (existing && existing.session_id !== identity.sessionId) {
      return { ok: false, error: "The Prolific session does not match the existing study record." };
    }
    if (existing && Number(existing.participant_slot)) {
      updateParticipantFields_(sheet, existing._rowNumber, { last_seen_at: new Date().toISOString() });
      return {
        ok: true,
        existing: true,
        slot: Number(existing.participant_slot),
        allocationId: existing.allocation_id,
        assignmentVersion: existing.assignment_version,
        status: existing.status,
        state: existing.state_json || ""
      };
    }

    const usedSlots = new Set(table.rows
      .filter(function(row) {
        return row.study_version === studyVersion
          && Number(row.participant_slot)
          && !["released", "released_with_partial_data"].includes(String(row.status));
      })
      .map(function(row) { return Number(row.participant_slot); }));
    let slot = null;
    for (let candidate = 1; candidate <= STUDY_DESIGN.participants; candidate += 1) {
      if (!usedSlots.has(candidate)) {
        slot = candidate;
        break;
      }
    }
    if (!slot) return { ok: false, error: "All 30 pre-generated allocation slots are assigned." };

    const allocationId = allocationIdForSlot_(slot);
    const fields = {
      participant_id: identity.participantId,
      session_id: identity.sessionId,
      study_id: identity.studyId,
      participant_slot: slot,
      allocation_id: allocationId,
      assignment_version: STUDY_DESIGN.assignmentVersion,
      status: "eligible",
      last_seen_at: new Date().toISOString(),
      completed_trials: 0,
      attention_checks_passed: 0,
      study_version: studyVersion
    };
    if (existing) {
      updateParticipantFields_(sheet, existing._rowNumber, fields);
    } else {
      const row = blankRow_(HEADERS.Participants);
      Object.assign(row, fields);
      appendObjectRow_(sheet, HEADERS.Participants, row);
    }
    return {
      ok: true,
      existing: Boolean(existing),
      slot: slot,
      allocationId: allocationId,
      assignmentVersion: STUDY_DESIGN.assignmentVersion,
      status: "eligible",
      state: existing ? existing.state_json || "" : ""
    };
  } finally {
    lock.releaseLock();
  }
}

function confirmRecord_(parameters) {
  const identity = validateIdentity_(parameters);
  verifyStudyVersion_(parameters.study_version);
  const eventId = safeIdentifier_(parameters.event_id, "event_id");
  const type = String(parameters.record_type || "");
  if (!["trial", "event"].includes(type)) throw new Error("Invalid record_type.");
  const spreadsheet = getSpreadsheet_();
  const sheet = getOrCreateSheet_(spreadsheet, type === "trial" ? SHEET_NAMES.trials : SHEET_NAMES.events);
  ensureHeaders_(sheet, type === "trial" ? HEADERS.Trials : HEADERS.Events);
  const match = findIdentityEvent_(sheet, eventId, identity);
  let jsonConfirmed = true;
  if (type === "trial") {
    const jsonSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.trialJson);
    ensureHeaders_(jsonSheet, HEADERS.TrialJSON);
    jsonConfirmed = Boolean(findIdentityEvent_(jsonSheet, eventId, identity));
  }
  return { ok: true, confirmed: Boolean(match) && jsonConfirmed, eventId: eventId, recordType: type };
}

function checkpoint_(parameters) {
  const identity = validateIdentity_(parameters);
  verifyStudyVersion_(parameters.study_version);
  const expected = Number(parameters.expected_trials);
  if (![38, 76, 114].includes(expected)) throw new Error("Invalid checkpoint size.");
  const result = trialCompleteness_(identity, expected);
  return {
    ok: true,
    expectedTrials: expected,
    confirmedTrials: result.confirmedTrials,
    missingGlobalTrialIndices: result.missing,
    complete: result.missing.length === 0
  };
}

function confirmFinal_(parameters) {
  const identity = validateIdentity_(parameters);
  verifyStudyVersion_(parameters.study_version);
  const eventId = safeIdentifier_(parameters.event_id, "event_id");
  const spreadsheet = getSpreadsheet_();
  const eventSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.events);
  ensureHeaders_(eventSheet, HEADERS.Events);
  const event = findIdentityEvent_(eventSheet, eventId, identity);
  const complete = completionAudit_(spreadsheet, identity);
  return {
    ok: true,
    confirmed: Boolean(event) && complete.complete,
    eventId: eventId,
    trialCount: complete.trialCount,
    setCounts: complete.setCounts,
    attentionChecksPassed: complete.attentionChecksPassed,
    completedBreaks: complete.completedBreaks,
    missingGlobalTrialIndices: complete.missing
  };
}

function storePayload_(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Payload must be an object.");
  const participant = payload.participant || {};
  const identity = validateIdentity_({
    participant_id: participant.participantId,
    study_id: participant.studyId,
    session_id: participant.sessionId
  });
  const studyVersion = verifyStudyVersion_(payload.studyVersion);
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
      return row.participant_id === identity.participantId
        && row.study_id === identity.studyId
        && row.study_version === studyVersion;
    });

    if (!participantRow) {
      if (["trial", "final"].includes(payload.kind)) throw new Error("Participant slot has not been reserved.");
      const blank = blankRow_(HEADERS.Participants);
      Object.assign(blank, {
        participant_id: identity.participantId,
        session_id: identity.sessionId,
        study_id: identity.studyId,
        status: payload.kind === "screenout" ? "screened_out" : "pre_allocation",
        last_seen_at: new Date().toISOString(),
        completed_trials: 0,
        attention_checks_passed: 0,
        study_version: studyVersion
      });
      appendObjectRow_(participantSheet, HEADERS.Participants, blank);
      participantTable = readTable_(participantSheet);
      participantRow = participantTable.rows[participantTable.rows.length - 1];
    }
    if (participantRow.session_id !== identity.sessionId) throw new Error("Session mismatch.");
    validateParticipantAllocation_(participantRow, participant, payload.kind);

    if (payload.kind === "trial") appendTrial_(spreadsheet, payload, identity, participantRow);
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
      const audit = completionAudit_(spreadsheet, identity);
      if (!audit.complete) {
        throw new Error("Final submission rejected: 114 trials, three attention checks, and two breaks were not all confirmed.");
      }
      appendEvent_(spreadsheet, {
        eventId: payload.finalEventId,
        type: "final",
        timestamp: payload.participantSummary?.completedAt || new Date().toISOString(),
        detail: Object.assign({}, payload.summary || {}, { serverAudit: audit })
      }, payload, identity);
    }

    const summary = payload.participantSummary || {};
    const update = {
      participant_slot: participant.slot ?? participantRow.participant_slot,
      allocation_id: participant.allocationId || participantRow.allocation_id,
      assignment_version: participant.assignmentVersion || participantRow.assignment_version,
      status: payload.outcome || summary.status || participantRow.status,
      consented_at: summary.consentedAt || participantRow.consented_at,
      started_at: summary.startedAt || participantRow.started_at,
      completed_at: summary.completedAt || participantRow.completed_at,
      last_seen_at: summary.lastSeenAt || new Date().toISOString(),
      completed_trials: summary.completedTrials ?? participantRow.completed_trials,
      attention_checks_passed: summary.attentionChecksPassed ?? participantRow.attention_checks_passed,
      eligibility_json: jsonCell_(summary.eligibility),
      color_test_json: jsonCell_(summary.colorTest),
      comprehension_json: jsonCell_(summary.comprehension),
      device_json: jsonCell_(summary.device),
      state_json: jsonCell_(payload.resumeState),
      study_version: studyVersion
    };
    if (payload.kind === "final") {
      update.status = "complete";
      update.completed_at = summary.completedAt || new Date().toISOString();
      update.final_event_id = payload.finalEventId || "";
    }
    if (payload.kind === "screenout") update.status = payload.outcome || "screened_out";
    updateParticipantFields_(participantSheet, participantRow._rowNumber, update);

    if (payload.kind === "final") {
      try {
        exportStudyLogs();
      } catch (error) {
        appendEvent_(spreadsheet, {
          eventId: eventIdFromPayload_(payload, "export_error"),
          type: "export_error",
          timestamp: new Date().toISOString(),
          detail: { message: String(error && error.message || error) }
        }, payload, identity);
      }
    }
    return { ok: true, kind: payload.kind };
  } finally {
    lock.releaseLock();
  }
}

function appendTrial_(spreadsheet, payload, identity, participantRow) {
  const record = payload.record || {};
  const canonical = validateTrialRecord_(record, payload.studyVersion, participantRow);
  const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.trials);
  ensureHeaders_(sheet, HEADERS.Trials);
  const existingEvent = findIdentityEvent_(sheet, canonical.event_id, identity);
  const existingIndex = findTrialAtGlobalIndex_(sheet, identity, canonical.global_trial_index);
  if (existingIndex && existingIndex.event_id !== canonical.event_id) {
    throw new Error("A conflicting response already exists for this global trial index.");
  }
  const stored = existingEvent || canonical;
  if (!existingEvent) appendObjectRow_(sheet, HEADERS.Trials, canonical);

  const jsonSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.trialJson);
  ensureHeaders_(jsonSheet, HEADERS.TrialJSON);
  if (!findIdentityEvent_(jsonSheet, canonical.event_id, identity)) {
    appendObjectRow_(jsonSheet, HEADERS.TrialJSON, {
      event_id: canonical.event_id,
      participant_id: identity.participantId,
      session_id: identity.sessionId,
      study_id: identity.studyId,
      global_trial_index: canonical.global_trial_index,
      record_json: JSON.stringify(objectFromHeaders_(HEADERS.Trials, stored)),
      received_at: stored.received_at,
      study_version: payload.studyVersion
    });
  }
}

function validateTrialRecord_(record, studyVersion, participantRow) {
  const eventId = safeIdentifier_(record.eventId, "trial event_id");
  const slot = integerInRange_(record.participantSlot, 1, 30, "participant_slot");
  if (slot !== Number(participantRow.participant_slot)) throw new Error("Trial participant slot mismatch.");
  const allocationId = safeIdentifier_(record.allocationId, "allocation_id");
  if (allocationId !== participantRow.allocation_id || allocationId !== allocationIdForSlot_(slot)) {
    throw new Error("Trial allocation mismatch.");
  }
  const setId = integerInRange_(record.setId, 1, 3, "set_id");
  const setTrialIndex = integerInRange_(record.setTrialIndex, 1, 38, "set_trial_index");
  const globalTrialIndex = integerInRange_(record.globalTrialIndex, 1, 114, "global_trial_index");
  if (globalTrialIndex !== (setId - 1) * 38 + setTrialIndex) throw new Error("Global trial index mismatch.");
  const documentId = String(record.documentId || "");
  if (!/^P(?:[1-9]|1\d)_DOC_[AB]$/.test(documentId)) throw new Error("Invalid document_id.");
  const conditionId = String(record.conditionId || "");
  const degreeValue = STUDY_DESIGN.conditions.indexOf(conditionId) + 1;
  if (!degreeValue || Number(record.degreeValue) !== degreeValue) throw new Error("Invalid condition or degree_value.");
  if (record.enrichedFile !== conditionId + ".html") throw new Error("Enriched filename mismatch.");
  if (!["left", "right"].includes(record.baselineSide) || !["left", "right"].includes(record.enrichedSide)
    || record.baselineSide === record.enrichedSide) throw new Error("Invalid side allocation.");
  if (Number(record.documentExposureNumber) !== setId) throw new Error("Document exposure number mismatch.");
  const expectedSeed = STUDY_DESIGN.assignmentSeed + ":participant:" + slot + ":documents:set:" + setId
    + ":rotation:" + ((setId - 1) * 13);
  if (record.randomizationSeed !== expectedSeed) throw new Error("Randomization seed mismatch.");
  const rating = numberInRange_(record.rating, -3, 3, "rating");
  const spatialRating = numberInRange_(record.spatialRating, -3, 3, "spatial_rating");
  if (!Number.isInteger(rating) || !Number.isInteger(spatialRating)) throw new Error("Ratings must be integers.");
  const responseTime = nonnegativeNumber_(record.responseTime, "response_time");
  const receivedAt = new Date().toISOString();
  return {
    event_id: eventId,
    participant_id: participantRow.participant_id,
    participant_slot: slot,
    set_id: setId,
    set_trial_index: setTrialIndex,
    global_trial_index: globalTrialIndex,
    document_id: documentId,
    condition_id: conditionId,
    enriched_file: record.enrichedFile,
    degree_value: degreeValue,
    baseline_side: record.baselineSide,
    document_exposure_number: setId,
    randomization_seed: record.randomizationSeed,
    rating: rating,
    response_time: responseTime,
    session_id: participantRow.session_id,
    study_id: participantRow.study_id,
    allocation_id: allocationId,
    enriched_side: record.enrichedSide,
    source_document_id: record.sourceDocumentId || "",
    stimulus_validation_status: record.validationStatus || "",
    visual_coverage: nullableNumber_(record.visualCoverage, "visual_coverage"),
    target_coverage: nullableNumber_(record.targetCoverage, "target_coverage"),
    retained_factor_count: nullableNumber_(record.retainedFactorCount, "retained_factor_count"),
    spatial_rating: spatialRating,
    planned_fixation_ms: nonnegativeNumber_(record.plannedFixationMs, "planned_fixation_ms"),
    planned_exposure_ms: nonnegativeNumber_(record.plannedExposureMs, "planned_exposure_ms"),
    actual_exposure_ms: nonnegativeNumber_(record.actualExposureMs, "actual_exposure_ms"),
    preload_ms: nonnegativeNumber_(record.preloadMs, "preload_ms"),
    attempt_count: integerInRange_(record.attemptCount, 1, 100, "attempt_count"),
    stimulus_scale: nonnegativeNumber_(record.stimulusScale, "stimulus_scale"),
    source_viewport_width: nonnegativeNumber_(record.sourceViewportWidth, "source_viewport_width"),
    source_viewport_height: nonnegativeNumber_(record.sourceViewportHeight, "source_viewport_height"),
    fitted_content_height: nonnegativeNumber_(record.fittedContentHeight, "fitted_content_height"),
    left_content_height: nonnegativeNumber_(record.leftContentHeight, "left_content_height"),
    right_content_height: nonnegativeNumber_(record.rightContentHeight, "right_content_height"),
    trimmed_bottom_whitespace_px: nonnegativeNumber_(record.trimmedBottomWhitespacePx, "trimmed_bottom_whitespace_px"),
    fullscreen: Boolean(record.fullscreen),
    display_info_json: jsonCell_(record.displayInfo),
    responded_at: String(record.respondedAt || ""),
    study_version: studyVersion,
    received_at: receivedAt
  };
}

function appendEvent_(spreadsheet, event, payload, identity) {
  const eventId = safeIdentifier_(event.eventId || eventIdFromPayload_(payload, event.type || "event"), "event_id");
  const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.events);
  ensureHeaders_(sheet, HEADERS.Events);
  if (findIdentityEvent_(sheet, eventId, identity)) return;
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

function trialCompleteness_(identity, expected) {
  const sheet = getOrCreateSheet_(getSpreadsheet_(), SHEET_NAMES.trials);
  ensureHeaders_(sheet, HEADERS.Trials);
  const indices = new Set(readTable_(sheet).rows
    .filter(function(row) {
      return row.participant_id === identity.participantId
        && row.session_id === identity.sessionId
        && row.study_id === identity.studyId
        && Number(row.global_trial_index) <= expected;
    })
    .map(function(row) { return Number(row.global_trial_index); }));
  const missing = [];
  for (let index = 1; index <= expected; index += 1) {
    if (!indices.has(index)) missing.push(index);
  }
  return { confirmedTrials: expected - missing.length, missing: missing };
}

function completionAudit_(spreadsheet, identity) {
  const trialSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.trials);
  ensureHeaders_(trialSheet, HEADERS.Trials);
  const rows = readTable_(trialSheet).rows.filter(function(row) {
    return row.participant_id === identity.participantId
      && row.session_id === identity.sessionId
      && row.study_id === identity.studyId;
  });
  const indexSet = new Set(rows.map(function(row) { return Number(row.global_trial_index); }));
  const missing = [];
  for (let index = 1; index <= 114; index += 1) if (!indexSet.has(index)) missing.push(index);
  const setCounts = [1, 2, 3].map(function(setId) {
    return rows.filter(function(row) { return Number(row.set_id) === setId; }).length;
  });

  const eventSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.events);
  ensureHeaders_(eventSheet, HEADERS.Events);
  const events = readTable_(eventSheet).rows.filter(function(row) {
    return row.participant_id === identity.participantId
      && row.session_id === identity.sessionId
      && row.study_id === identity.studyId;
  });
  const passedAttentionPositions = new Set();
  const completedBreaks = new Set();
  events.forEach(function(row) {
    const detail = parseJsonCell_(row.detail_json);
    if (row.event_type === "attention_check" && detail.passed === true) {
      passedAttentionPositions.add(Number(detail.afterTrial));
    }
    if (row.event_type === "break_completed") {
      completedBreaks.add(Number(detail.setId || (detail.detail && detail.detail.setId)));
    }
  });
  const attentionChecksPassed = passedAttentionPositions.size;
  const completedBreakCount = completedBreaks.size;
  return {
    complete: rows.length === 114
      && missing.length === 0
      && setCounts.every(function(count) { return count === 38; })
      && attentionChecksPassed === 3
      && completedBreakCount === 2,
    trialCount: rows.length,
    setCounts: setCounts,
    missing: missing,
    attentionChecksPassed: attentionChecksPassed,
    completedBreaks: completedBreakCount
  };
}

function exportStudyLogs() {
  const spreadsheet = getSpreadsheet_();
  const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.trials);
  ensureHeaders_(sheet, HEADERS.Trials);
  const table = readTable_(sheet);
  const records = table.rows.map(function(row) {
    const object = {};
    HEADERS.Trials.forEach(function(header) { object[header] = serializable_(row[header]); });
    return object;
  });
  const csv = [HEADERS.Trials].concat(records.map(function(record) {
    return HEADERS.Trials.map(function(header) { return record[header]; });
  })).map(function(row) { return row.map(csvCell_).join(","); }).join("\n") + "\n";
  const json = JSON.stringify({
    schema_version: "text-enrichment-trial-log-v2",
    study_version: configuredStudyVersion_(),
    exported_at: new Date().toISOString(),
    record_count: records.length,
    columns: HEADERS.Trials,
    records: records
  }, null, 2) + "\n";
  const folder = getExportFolder_(spreadsheet);
  const csvFile = upsertTextFile_(folder, "text-enrichment-final-log.csv", csv, MimeType.CSV);
  const jsonFile = upsertTextFile_(folder, "text-enrichment-final-log.json", json, MimeType.PLAIN_TEXT);
  return { csvFileId: csvFile.getId(), jsonFileId: jsonFile.getId(), recordCount: records.length };
}

function releaseIncompleteSlot(participantId, studyId) {
  const identityParticipant = safeIdentifier_(participantId, "participant_id");
  const identityStudy = safeIdentifier_(studyId, "study_id");
  const studyVersion = configuredStudyVersion_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = getSpreadsheet_();
    const sheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.participants);
    ensureHeaders_(sheet, HEADERS.Participants);
    const row = readTable_(sheet).rows.find(function(item) {
      return item.participant_id === identityParticipant
        && item.study_id === identityStudy
        && item.study_version === studyVersion;
    });
    if (!row) throw new Error("Participant record not found.");
    if (row.status === "complete") throw new Error("A completed slot cannot be released.");
    const trialSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.trials);
    ensureHeaders_(trialSheet, HEADERS.Trials);
    const partialCount = readTable_(trialSheet).rows.filter(function(trial) {
      return trial.participant_id === identityParticipant && trial.study_id === identityStudy;
    }).length;
    updateParticipantFields_(sheet, row._rowNumber, {
      participant_slot: "",
      status: partialCount ? "released_with_partial_data" : "released",
      last_seen_at: new Date().toISOString()
    });
    return { released: true, allocationId: row.allocation_id, partialTrialCount: partialCount };
  } finally {
    lock.releaseLock();
  }
}

function validateParticipantAllocation_(participantRow, participant, kind) {
  if (!["trial", "final", "snapshot"].includes(kind)) return;
  if (!Number(participantRow.participant_slot)) throw new Error("Participant slot has not been reserved.");
  if (Number(participant.slot) !== Number(participantRow.participant_slot)) throw new Error("Participant slot mismatch.");
  if (participant.allocationId !== participantRow.allocation_id) throw new Error("Allocation identifier mismatch.");
  if (participant.assignmentVersion !== STUDY_DESIGN.assignmentVersion) throw new Error("Assignment version mismatch.");
}

function allocationIdForSlot_(slot) {
  return STUDY_DESIGN.assignmentVersion + "-slot-" + String(slot).padStart(2, "0");
}

function findIdentityEvent_(sheet, eventId, identity) {
  if (sheet.getLastRow() < 2) return null;
  const matches = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(eventId)
    .matchEntireCell(true)
    .findAll();
  if (!matches.length) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  for (let index = 0; index < matches.length; index += 1) {
    const values = sheet.getRange(matches[index].getRow(), 1, 1, headers.length).getValues()[0];
    const row = {};
    headers.forEach(function(header, column) { row[header] = values[column]; });
    if (row.participant_id === identity.participantId
      && (!row.study_id || row.study_id === identity.studyId)
      && (!row.session_id || row.session_id === identity.sessionId)) return row;
  }
  return null;
}

function findTrialAtGlobalIndex_(sheet, identity, globalTrialIndex) {
  if (sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const indexColumn = headers.indexOf("global_trial_index") + 1;
  const matches = sheet.getRange(2, indexColumn, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(globalTrialIndex))
    .matchEntireCell(true)
    .findAll();
  for (let index = 0; index < matches.length; index += 1) {
    const values = sheet.getRange(matches[index].getRow(), 1, 1, headers.length).getValues()[0];
    const row = {};
    headers.forEach(function(header, column) { row[header] = values[column]; });
    if (row.participant_id === identity.participantId
      && row.study_id === identity.studyId
      && row.session_id === identity.sessionId) return row;
  }
  return null;
}

function eventIdFromPayload_(payload, label) {
  const participant = payload.participant || {};
  const value = [payload.studyVersion, participant.sessionId, label, new Date().getTime()].join(":");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  const hex = digest.map(function(byte) { return (byte + 256).toString(16).slice(-2); }).join("");
  return label + "_" + hex.slice(0, 16);
}

function getSpreadsheet_() {
  const propertyId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (propertyId) return SpreadsheetApp.openById(propertyId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("Bind this script to the study spreadsheet or set SPREADSHEET_ID.");
  return active;
}

function getExportFolder_(spreadsheet) {
  const folderId = PropertiesService.getScriptProperties().getProperty("EXPORT_FOLDER_ID");
  if (folderId) return DriveApp.getFolderById(folderId);
  const parents = DriveApp.getFileById(spreadsheet.getId()).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

function upsertTextFile_(folder, name, content, mimeType) {
  const matches = folder.getFilesByName(name);
  if (matches.hasNext()) {
    const file = matches.next();
    file.setContent(content);
    return file;
  }
  return folder.createFile(name, content, mimeType);
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  for (let index = 0; index < existing.length; index += 1) {
    if (existing[index] !== headers[index]) {
      throw new Error("Unexpected header order in " + sheet.getName() + " at column " + String(index + 1) + ". Use a fresh workbook for the v7 schema.");
    }
  }
  if (existing.length < headers.length) {
    sheet.getRange(1, existing.length + 1, 1, headers.length - existing.length)
      .setValues([headers.slice(existing.length)]);
  }
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
  sheet.appendRow(headers.map(function(header) { return safeCell_(object[header]); }));
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
  const expected = configuredStudyVersion_();
  if (expected && expected !== text) throw new Error("Study version mismatch.");
  return text;
}

function configuredStudyVersion_() {
  return PropertiesService.getScriptProperties().getProperty("STUDY_VERSION") || "2026-08-25-v7";
}

function integerInRange_(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error("Invalid " + field + ".");
  return number;
}

function numberInRange_(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error("Invalid " + field + ".");
  return number;
}

function nonnegativeNumber_(value, field) {
  return numberInRange_(value, 0, Number.MAX_SAFE_INTEGER, field);
}

function nullableNumber_(value, field) {
  if (value === undefined || value === null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid " + field + ".");
  return number;
}

function jsonCell_(value) {
  if (value === undefined || value === null) return "";
  const text = JSON.stringify(value);
  return text.length > 49000 ? JSON.stringify({ truncated: true, prefix: text.slice(0, 48000) }) : text;
}

function parseJsonCell_(value) {
  if (!value) return {};
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch (error) { return {}; }
}

function safeCell_(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" && /^[=+@]/.test(value)) return "'" + value;
  return value;
}

function blankRow_(headers) {
  return Object.fromEntries(headers.map(function(header) { return [header, ""]; }));
}

function objectFromHeaders_(headers, object) {
  const result = {};
  headers.forEach(function(header) { result[header] = serializable_(object[header]); });
  return result;
}

function serializable_(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function csvCell_(value) {
  if (value === undefined || value === null) return "";
  const text = String(serializable_(value));
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function output_(object, callback) {
  const json = JSON.stringify(object).replace(/</g, "\\u003c");
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
