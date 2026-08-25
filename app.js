import { hashString, loadParticipantAssignment, mulberry32 } from "./assignment.js?v=2026-08-25-v7";
import { containsKoreanLanguage } from "./eligibility.js?v=2026-08-25-v7";
import { expectedAttentionResponse } from "./attention.js?v=2026-08-25-v7";
import { calculateStimulusFit, choosePairContentHeight, resolveMeasuredHeight } from "./stimulus-fit.js?v=2026-08-25-v7";
import { finalStateIsComplete, nextStudyAction, remainingBreakMs } from "./study-flow.js?v=2026-08-25-v7";

const CONFIG = window.STUDY_CONFIG;
const app = document.getElementById("app");
const siteHeader = document.getElementById("site-header");
const progressWrap = document.getElementById("progress-wrap");
const progress = document.getElementById("progress");
const progressLabel = document.getElementById("progress-label");
const params = new URLSearchParams(window.location.search);
const isPreview = params.get("preview") === "1";
const isFastPreview = isPreview && params.get("fast") === "1";
const timings = {
  fixationMs: isFastPreview ? 80 : CONFIG.timings.fixationMs,
  exposureMs: isFastPreview ? 120 : CONFIG.timings.exposureMs,
  redirectDelayMs: CONFIG.timings.redirectDelayMs
};
const minimumBreakMs = isFastPreview ? 500 : CONFIG.minimumBreakMs;

const prolific = {
  participantId: cleanIdentifier(params.get("PROLIFIC_PID")),
  studyId: cleanIdentifier(params.get("STUDY_ID")),
  sessionId: cleanIdentifier(params.get("SESSION_ID"))
};

const storageKey = [
  "te-reader-study",
  CONFIG.version,
  prolific.studyId || "preview-study",
  prolific.participantId || "preview-participant"
].join(":");

let state = createInitialState();
let assignment = null;
let activeFlush = null;
const stimulusCache = new Map();

function cleanIdentifier(value) {
  if (!value) return "";
  return /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : "";
}

function createInitialState() {
  return {
    version: CONFIG.version,
    status: "new",
    participantId: prolific.participantId,
    studyId: prolific.studyId,
    sessionId: prolific.sessionId,
    consentedAt: null,
    startedAt: null,
    completedAt: null,
    slot: null,
    allocationId: null,
    assignmentVersion: null,
    eligibility: null,
    colorTest: null,
    comprehension: { attempts: 0, passed: false },
    screen: null,
    practiceIndex: 0,
    practiceComplete: false,
    trialCursor: 0,
    attentionChecks: [],
    attentionAttempts: {},
    eventSequence: 0,
    breaks: [],
    checkpointedSets: [],
    postStudy: null,
    events: [],
    pendingUploads: []
  };
}

function saveLocal() {
  if (!state.consentedAt && state.status !== "complete") return;
  try {
    const recoveryState = { ...state, events: [] };
    localStorage.setItem(storageKey, JSON.stringify(recoveryState));
  } catch (error) {
    console.warn("Local save failed", error);
  }
}

function loadLocal() {
  try {
    const value = localStorage.getItem(storageKey);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return parsed && parsed.version === CONFIG.version ? parsed : null;
  } catch (error) {
    return null;
  }
}

function setView(html, options = {}) {
  app.innerHTML = html;
  app.className = options.fullBleed ? "full-bleed" : "";
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function setHeader(status, showProgress = false) {
  siteHeader.hidden = !showProgress;
  progressWrap.hidden = !showProgress;
  if (showProgress) {
    progress.max = CONFIG.trialCount;
    progress.value = state.trialCursor;
    progressLabel.textContent = String(state.trialCursor) + " / " + String(CONFIG.trialCount);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function recordEvent(type, detail = {}) {
  state.eventSequence = Number(state.eventSequence || 0) + 1;
  const event = {
    eventId: makeEventId("event", type + ":" + state.eventSequence + ":" + Date.now()),
    participantId: state.participantId,
    sessionId: state.sessionId,
    type,
    timestamp: nowIso(),
    detail
  };
  state.events.push(event);
  if (state.events.length > 120) state.events = state.events.slice(-120);
  saveLocal();
  if (CONFIG.dataEndpoint && !isPreview) queueRemote("event", { event });
  return event;
}

function makeEventId(kind, suffix) {
  const base = [CONFIG.version, state.sessionId || "preview", kind, suffix].join(":");
  const first = hashString(base).toString(16).padStart(8, "0");
  const second = hashString("secondary:" + base).toString(16).padStart(8, "0");
  return kind + "_" + first + second;
}

function collectScreenInfo() {
  const viewport = window.visualViewport;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || "",
    language: navigator.language,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    availableWidth: window.screen.availWidth,
    availableHeight: window.screen.availHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    devicePixelRatio: window.devicePixelRatio,
    colorDepth: window.screen.colorDepth,
    visualViewportScale: viewport?.scale || null,
    approximateZoom: window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : null,
    pointerFine: matchMedia("(any-pointer: fine)").matches,
    hoverAvailable: matchMedia("(any-hover: hover)").matches,
    touchPoints: navigator.maxTouchPoints || 0,
    fullscreenSupported: Boolean(document.documentElement.requestFullscreen),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    capturedAt: nowIso()
  };
}

function deviceIsEligible(info) {
  const mobileAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(info.userAgent);
  return !mobileAgent
    && info.innerWidth >= CONFIG.device.minimumWidth
    && info.innerHeight >= CONFIG.device.minimumHeight
    && info.pointerFine;
}

function configProblems() {
  const problems = [];
  if (!CONFIG || CONFIG.docIds.length !== 38 || CONFIG.conditionOrder.length !== 6
    || CONFIG.trialCount !== 114 || CONFIG.setCount !== 3 || CONFIG.trialsPerSet !== 38) {
    problems.push("The study manifest is incomplete.");
  }
  if (!isPreview) {
    if (!prolific.participantId || !prolific.studyId || !prolific.sessionId) {
      problems.push("The Prolific URL parameters are missing.");
    }
    if (!CONFIG.dataEndpoint) problems.push("The data endpoint has not been configured.");
    ["complete", "screenedOut", "noConsent"].forEach((key) => {
      if (!CONFIG.redirects[key]) problems.push("The Prolific " + key + " redirect has not been configured.");
    });
  }
  return problems;
}

function renderConfigurationError(problems) {
  setHeader("Researcher configuration required");
  setView(
    '<section class="card compact-card">' +
      '<h1>This study is not ready to start.</h1>' +
      '<p>Please return to Prolific and message the researcher. No response data has been collected.</p>' +
      '<div class="notice error">' + problems.map(escapeHtml).join("<br>") + "</div>" +
      '<p class="small muted mono">Use ?preview=1&slot=1 for researcher preview.</p>' +
    "</section>"
  );
}

function init() {
  const problems = configProblems();
  if (problems.length) {
    renderConfigurationError(problems);
    return;
  }

  const saved = loadLocal();
  if (saved && ["eligible", "in_progress", "ready_to_submit", "upload_error"].includes(saved.status)) {
    state = Object.assign(createInitialState(), saved);
    renderResume();
    return;
  }
  if (saved && saved.status === "complete") {
    state = Object.assign(createInitialState(), saved);
    renderAlreadyComplete();
    return;
  }
  renderWelcome();
}

function renderWelcome() {
  setHeader("Study information");
  setView(
    '<section class="card compact-card">' +
      '<h1>Study information</h1>' +
      '<p>You will complete 114 brief visual comparisons in three sets. The study takes about 20–25 minutes.</p>' +
      '<div class="device-requirement" role="note"><strong>Device requirement</strong>' +
        '<span>This study can only be completed on a laptop or desktop computer using a mouse or trackpad. Mobile phones and tablets are not supported.</span></div>' +
      '<h2>Before you agree</h2>' +
      '<ul class="consent-points">' +
        '<li>Participation is voluntary. You may stop at any time by closing this page and returning your submission on Prolific.</li>' +
        '<li>We record your Prolific participant, study, and session IDs.</li>' +
        '<li>We record your responses, response times, and study-quality checks.</li>' +
        '<li>We record display and browser information needed to evaluate timing quality.</li>' +
        '<li>We do not ask for your name, email address, or other direct identifiers.</li>' +
      '</ul>' +
      '<p>Your pseudonymous data will be used for research on online reading and text formatting. ' + escapeHtml(CONFIG.researcherContact) + "</p>" +
      '<hr class="rule">' +
      '<label class="check-row"><input id="consent-check" type="checkbox"><span><strong>I am at least 18 years old, I have read the information above, and I consent to participate.</strong></span></label>' +
      '<div class="actions">' +
        '<button class="button" id="consent-button" disabled>Continue</button>' +
        '<button class="button secondary" id="decline-button">I do not consent</button>' +
      "</div>" +
    "</section>"
  );
  const check = document.getElementById("consent-check");
  const button = document.getElementById("consent-button");
  check.addEventListener("change", () => { button.disabled = !check.checked; });
  button.addEventListener("click", acceptConsent);
  document.getElementById("decline-button").addEventListener("click", declineConsent);
}

function declineConsent() {
  setHeader("No consent");
  setView(
    '<section class="card compact-card">' +
      '<h1>No data was collected.</h1><p>Please return to Prolific. Your place will be reopened for another participant.</p>' +
      '<div class="actions"><button class="button" id="return-button">Return to Prolific</button></div></section>'
  );
  document.getElementById("return-button").addEventListener("click", () => redirectTo(CONFIG.redirects.noConsent));
  window.setTimeout(() => redirectTo(CONFIG.redirects.noConsent), timings.redirectDelayMs);
}

function acceptConsent() {
  state.consentedAt = nowIso();
  state.status = "consented";
  state.screen = collectScreenInfo();
  saveLocal();
  recordEvent("consent_given");
  if (!isPreview && !deviceIsEligible(state.screen)) {
    terminateEarly("screened_out", "incompatible_device", "screenedOut");
    return;
  }
  renderEligibility();
}

function renderEligibility() {
  setHeader("Eligibility check");
  setView(
    '<section class="card compact-card">' +
      '<h1>Quick eligibility check</h1>' +
      '<p>Please answer the following questions before beginning the task.</p>' +
      '<form id="eligibility-form" class="question-stack">' +
        '<div class="question"><label for="frequency"><strong>How often do you voluntarily read creator-led newsletters, blogs, or similar text-based online publications?</strong></label>' +
          '<select id="frequency" required><option value="">Select one</option><option value="daily">Daily</option><option value="several_weekly">Several times a week</option><option value="weekly">About once a week</option><option value="less_weekly">Less than once a week</option><option value="never">Never</option></select></div>' +
        '<div class="question"><label for="native-language"><strong>What is your native language?</strong></label>' +
          '<input id="native-language" type="text" autocomplete="off" required placeholder="e.g., English"></div>' +
        '<div class="question"><label for="spoken-languages"><strong>What other languages can you use comfortably?</strong></label>' +
          '<input id="spoken-languages" type="text" autocomplete="off" required placeholder="List languages separated by commas, or enter None"></div>' +
        '<div class="question"><fieldset><legend>Do you have normal or corrected-to-normal vision?</legend>' +
          '<label class="radio-row"><input type="radio" name="vision" value="yes" required><span>Yes</span></label>' +
          '<label class="radio-row"><input type="radio" name="vision" value="no"><span>No</span></label></fieldset></div>' +
        '<div class="actions right"><button class="button" type="submit">Continue</button></div>' +
      "</form>" +
    "</section>"
  );
  document.getElementById("eligibility-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.eligibility = {
      readingFrequency: document.getElementById("frequency").value,
      nativeLanguage: document.getElementById("native-language").value.trim(),
      spokenLanguages: document.getElementById("spoken-languages").value.trim(),
      normalOrCorrectedVision: form.get("vision"),
      answeredAt: nowIso()
    };
    saveLocal();
    const eligibleFrequency = ["daily", "several_weekly", "weekly"].includes(state.eligibility.readingFrequency);
    const reportsKorean = containsKoreanLanguage(state.eligibility.nativeLanguage) || containsKoreanLanguage(state.eligibility.spokenLanguages);
    if (!eligibleFrequency || reportsKorean || state.eligibility.normalOrCorrectedVision !== "yes") {
      terminateEarly("screened_out", "eligibility_criteria", "screenedOut");
      return;
    }
    renderColorTest();
  });
}

function renderColorTest() {
  setHeader("Color-vision check");
  setView(
    '<section class="card wide-card">' +
      '<h1>Color-vision eligibility check</h1>' +
      '<p>Some article versions use color. Enter the number you see in the dot pattern. This brief display-specific check is for study eligibility only and is not a medical diagnosis.</p>' +
      '<form id="color-form">' +
        '<div class="plate-grid">' +
          plateCard(0) +
        "</div>" +
        '<div id="color-error" class="notice error hidden" role="alert"></div>' +
        '<div class="actions right"><button class="button" type="submit">Check and continue</button></div>' +
      "</form>" +
    "</section>"
  );
  const plateDefinitions = [
    { plate: 2, answer: "6", seed: 306, foreground: ["#b53d2e", "#d3543f", "#982f24"], background: ["#8fc5a1", "#a9d6b5", "#78b68d"] }
  ];
  plateDefinitions.forEach((definition, index) => drawPlate(document.getElementById("plate-" + index), definition));
  document.getElementById("color-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const responses = plateDefinitions.map((definition, index) => ({
      plate: definition.plate,
      expected: definition.answer,
      response: document.getElementById("plate-answer-" + index).value.trim()
    }));
    const correct = responses.filter((item) => item.response === item.expected).length;
    state.colorTest = { responses, correct, passed: correct === plateDefinitions.length, answeredAt: nowIso() };
    saveLocal();
    if (!state.colorTest.passed) {
      terminateEarly("screened_out", "color_vision_check", "screenedOut");
      return;
    }
    renderInstructions();
  });
}

function plateCard(index) {
  return '<div class="plate-card"><canvas id="plate-' + index + '" width="280" height="280" aria-label="Color-dot number pattern"></canvas>' +
    '<label class="visually-hidden" for="plate-answer-' + index + '">Number shown in the color-dot pattern</label>' +
    '<input id="plate-answer-' + index + '" type="text" inputmode="numeric" autocomplete="off" maxlength="2" required aria-label="Number shown in the color-dot pattern"></div>';
}

function drawPlate(canvas, definition) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const maskCtx = mask.getContext("2d");
  maskCtx.clearRect(0, 0, mask.width, mask.height);
  maskCtx.fillStyle = "#000";
  maskCtx.font = definition.answer.length > 1 ? "900 132px Arial" : "900 164px Arial";
  maskCtx.textAlign = "center";
  maskCtx.textBaseline = "middle";
  maskCtx.fillText(definition.answer, mask.width / 2, mask.height / 2 + 4);
  const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height).data;
  const random = mulberry32(definition.seed);
  ctx.fillStyle = "#e9e7dd";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.48, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < 500; i += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 3.8 + random() * 6.8;
    const pixel = (Math.floor(y) * canvas.width + Math.floor(x)) * 4 + 3;
    const inDigit = maskData[pixel] > 80;
    const colors = inDigit ? definition.foreground : definition.background;
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.globalAlpha = 0.82 + random() * 0.18;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#b9b7ae";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.48, 0, Math.PI * 2);
  ctx.stroke();
}

function renderInstructions(errorMessage = "") {
  setHeader("Task instructions");
  setView(
    '<section class="card wide-card">' +
      '<h1>Instruction &amp; Comprehension Test</h1>' +
      '<p class="lede">For every trial, focus on the cross. Two versions of the same article will then appear side by side for ' +
        escapeHtml(String(CONFIG.timings.exposureMs)) + ' ms.</p>' +
      '<ol class="instruction-flow" aria-label="Trial sequence">' +
        '<li><strong>Focus on the cross</strong><span>750 ms</span></li>' +
        '<li><strong>View both versions</strong><span>1,000 ms</span></li>' +
        '<li><strong>Rate left versus right</strong><span>−3 to +3</span></li>' +
        '<li><strong>Continue</strong><span>Next trial</span></li>' +
      "</ol>" +
      '<div class="task-callout"><strong>Your task</strong><p>Which version would motivate you more to continue reading, based on its visual appearance? Do not try to read every word. There is no objectively correct preference.</p></div>' +
      '<p>Keep this page full screen, keep the tab active, and do not resize the window during a trial. If timing is interrupted, that trial will be repeated automatically.</p>' +
      '<hr class="rule">' +
      '<h2>Comprehension check</h2><p>The instructions remain visible above. You have two chances.</p>' +
      (errorMessage ? '<div class="notice error" role="alert">' + escapeHtml(errorMessage) + "</div>" : "") +
      '<form id="comprehension-form" class="question-stack">' +
        '<div class="question"><fieldset><legend>How long will the two article versions be visible?</legend>' +
          comprehensionOption("duration", "until_answer", "Until I answer") +
          comprehensionOption("duration", "one_second", "About one second") +
          comprehensionOption("duration", "ten_seconds", "About ten seconds") +
        "</fieldset></div>" +
        '<div class="question"><fieldset><legend>What should your rating represent?</legend>' +
          comprehensionOption("judgment", "accuracy", "Which version contains more accurate information") +
          comprehensionOption("judgment", "first_impression", "Which version would motivate me more to continue reading, based on its visual appearance") +
          comprehensionOption("judgment", "memory", "Which version I remember word for word") +
        "</fieldset></div>" +
        '<div class="actions right"><button class="button" type="submit">Check answers</button></div>' +
      "</form>" +
    "</section>"
  );
  document.getElementById("comprehension-form").addEventListener("submit", handleComprehension);
}

function comprehensionOption(name, value, label) {
  return '<label class="radio-row"><input type="radio" name="' + name + '" value="' + value + '" required><span>' +
    escapeHtml(label) + "</span></label>";
}

async function handleComprehension(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.comprehension.attempts += 1;
  state.comprehension.lastResponses = {
    duration: form.get("duration"),
    judgment: form.get("judgment")
  };
  state.comprehension.passed = form.get("duration") === "one_second" && form.get("judgment") === "first_impression";
  state.comprehension.answeredAt = nowIso();
  saveLocal();
  if (state.comprehension.passed) {
    await allocateParticipantSlot();
    return;
  }
  if (state.comprehension.attempts >= 2) {
    terminateEarly("screened_out", "failed_comprehension_twice", "screenedOut");
    return;
  }
  renderInstructions("One or more answers were incorrect. Please re-read the instructions and try once more.");
}

async function allocateParticipantSlot() {
  setHeader("Assigning study materials");
  setView(
    '<section class="card compact-card" aria-busy="true">' +
      '<h1>Preparing your study set…</h1><p class="muted">Do not refresh this page.</p></section>'
  );
  try {
    let allocation;
    if (isPreview) {
      const requested = Number(params.get("slot") || "1");
      allocation = { ok: true, slot: Math.min(30, Math.max(1, Number.isInteger(requested) ? requested : 1)), existing: false };
    } else {
      allocation = await jsonp(CONFIG.dataEndpoint, {
        action: "reserve",
        participant_id: state.participantId,
        study_id: state.studyId,
        session_id: state.sessionId,
        study_version: CONFIG.version
      });
    }
    if (!allocation?.ok || !allocation.slot) {
      throw new Error(allocation?.error || "No study slot is available.");
    }
    state.slot = Number(allocation.slot);
    assignment = await loadCurrentAssignment(state.slot);
    if (allocation.allocationId && allocation.allocationId !== assignment.allocationId) {
      throw new Error("The server allocation does not match the pre-generated slot file.");
    }
    if (allocation.assignmentVersion && allocation.assignmentVersion !== assignment.assignmentVersion) {
      throw new Error("The server and browser assignment versions do not match.");
    }
    state.allocationId = assignment.allocationId;
    state.assignmentVersion = assignment.assignmentVersion;
    state.startedAt = state.startedAt || nowIso();
    state.status = "eligible";

    const backendState = parseBackendState(allocation.state);
    if (backendState && Number(backendState.trialCursor) > state.trialCursor) {
      state = Object.assign(state, backendState, {
        version: CONFIG.version,
        participantId: prolific.participantId,
        studyId: prolific.studyId,
        sessionId: prolific.sessionId,
        slot: Number(allocation.slot),
        allocationId: assignment.allocationId,
        assignmentVersion: assignment.assignmentVersion,
        pendingUploads: state.pendingUploads || [],
        events: state.events || []
      });
    }
    saveLocal();
    queueRemote("snapshot", { reason: "eligible" });
    renderPracticeIntro();
  } catch (error) {
    renderBackendError(error);
  }
}

function loadCurrentAssignment(participantSlot) {
  return loadParticipantAssignment({
    participantSlot: Number(participantSlot),
    studyVersion: CONFIG.version,
    assignmentVersion: CONFIG.assignmentVersion
  });
}

function parseBackendState(value) {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    return null;
  }
}

function renderBackendError(error) {
  state.status = "upload_error";
  saveLocal();
  setHeader("Connection problem");
  setView(
    '<section class="card compact-card"><h1>We could not reserve your study materials.</h1>' +
      '<p>Your progress on this device is safe. Check your connection and try again. If this continues, return the submission and message the researcher.</p>' +
      '<div class="notice error">' + escapeHtml(error.message || "Unknown connection error") + "</div>" +
      '<div class="actions"><button class="button" id="retry-allocation">Try again</button></div></section>'
  );
  document.getElementById("retry-allocation").addEventListener("click", allocateParticipantSlot);
}

function renderPracticeIntro() {
  setHeader("Practice");
  setView(
    '<section class="card compact-card"><h1>Try two practice trials</h1>' +
      '<p>The practice uses the same timing and response scale as the main study. Practice responses are not included in the main analysis.</p>' +
      '<div class="notice">Please set browser zoom to 100%, maximize the window, and close unrelated tabs or programs that may interrupt the display.</div>' +
      '<div class="actions"><button class="button" id="start-practice">Enter full screen and begin</button></div></section>'
  );
  document.getElementById("start-practice").addEventListener("click", async () => {
    await requestStudyFullscreen();
    state.practiceIndex = state.practiceIndex || 0;
    saveLocal();
    runPracticeTrial();
  });
}

async function requestStudyFullscreen() {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    recordEvent("fullscreen_entered");
  } catch (error) {
    recordEvent("fullscreen_denied", { message: error.message });
  }
}

const practiceDocs = [
  makePracticeDoc("Small urban gardens", [
    "Small gardens can support pollinators while giving city residents a quiet place to pause.",
    "A mix of herbs, native flowers, and shallow water can attract a surprising variety of insects.",
    "Start with one sunny container, observe what visits, and adjust the planting over time."
  ], ["Small gardens", "pollinators", "Start with one sunny container"]),
  makePracticeDoc("Repair before replacement", [
    "Many household objects fail because one inexpensive component wears out before the rest.",
    "Repair guides and shared tool libraries can make a small fix practical even for beginners.",
    "Checking whether an item can be repaired first may save money and reduce unnecessary waste."
  ], ["one inexpensive component", "shared tool libraries", "save money"])
];

function makePracticeDoc(title, paragraphs, emphasizedPhrases) {
  const baseBody = "<h1>" + escapeHtml(title) + "</h1>" + paragraphs.map((p) => "<p>" + escapeHtml(p) + "</p>").join("");
  let enrichedBody = baseBody;
  emphasizedPhrases.forEach((phrase, index) => {
    const replacement = index === 0
      ? "<strong>" + escapeHtml(phrase) + "</strong>"
      : index === 1
        ? '<span class="marker">' + escapeHtml(phrase) + "</span>"
        : '<span class="underline">' + escapeHtml(phrase) + "</span>";
    enrichedBody = enrichedBody.replace(escapeHtml(phrase), replacement);
  });
  const wrap = (body) => '<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#fafafa;font-family:Arial,sans-serif;color:#191919}.doc{width:800px;margin:24px auto;background:#fff;border:1px solid #ddd;border-radius:8px;padding:52px 58px}h1{font-size:36px;line-height:1.15;margin:0 0 28px}p{font-size:22px;line-height:1.65;margin:0 0 22px}.marker{background:#e6dfae;padding:1px 3px}.underline{text-decoration:underline;text-decoration-thickness:3px;text-underline-offset:4px}</style></head><body><article class="doc">' + body + "</article></body></html>";
  return {
    doc_id: "PRACTICE_" + hashString(title).toString(16),
    viewport_width: 900,
    viewport_height: 950,
    html: { baseline: wrap(baseBody), enriched: wrap(enrichedBody) }
  };
}

function runPracticeTrial() {
  const index = state.practiceIndex;
  if (index >= practiceDocs.length) {
    state.practiceComplete = true;
    state.status = "in_progress";
    saveLocal();
    renderMainIntro();
    return;
  }
  const baselineLeft = index % 2 === 0;
  const trial = {
    practice: true,
    docId: practiceDocs[index].doc_id,
    baselineSide: baselineLeft ? "left" : "right",
    enrichedSide: baselineLeft ? "right" : "left",
    trialOrder: index
  };
  runStimulusTrial(trial, practiceDocs[index], 1);
}

function renderMainIntro() {
  setHeader("Main study");
  setView(
    '<section class="card compact-card"><h1>Main Study</h1>' +
      '<p>You will complete 114 comparisons in three sets of 38. A required 60-second break follows Set 1 and Set 2, and one clearly labeled attention check appears in each set. Every response is saved automatically.</p>' +
      '<div class="actions"><button class="button" id="begin-main">Begin main study</button></div></section>'
  );
  document.getElementById("begin-main").addEventListener("click", () => {
    state.status = "in_progress";
    saveLocal();
    continueMain();
  });
}

async function fetchStimulus(docId) {
  if (stimulusCache.has(docId)) return stimulusCache.get(docId);
  const request = fetch("./stimuli/" + encodeURIComponent(docId) + ".json?v=" + encodeURIComponent(CONFIG.version), { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("Could not load " + docId);
      return response.json();
    });
  stimulusCache.set(docId, request);
  return request;
}

function prefetchNext() {
  const next = assignment?.trials[state.trialCursor + 1];
  if (next) fetchStimulus(next.docId).catch(() => {});
}

async function continueMain() {
  if (!assignment && state.slot) {
    try {
      assignment = await loadCurrentAssignment(state.slot);
    } catch (error) {
      renderAssignmentLoadError(error);
      return;
    }
  }
  setHeader("Main study", true);
  const action = nextStudyAction(state, CONFIG);
  if (action.type === "attention") return renderAttentionCheck(action.afterTrial);
  if (action.type === "break") return prepareSetBreak(action.afterTrial);
  if (action.type === "post_study") return renderPostStudy();

  const trial = assignment.trials[state.trialCursor];
  try {
    const doc = await fetchStimulus(trial.docId);
    prefetchNext();
    runStimulusTrial(trial, doc, 1);
  } catch (error) {
    renderStimulusLoadError(error);
  }
}

function renderAssignmentLoadError(error) {
  setHeader("Allocation problem", true);
  setView(
    '<section class="card compact-card"><h1>Your assigned study set could not be loaded.</h1>' +
      '<p>Your progress is safe. Check the connection and try again.</p>' +
      '<div class="notice error">' + escapeHtml(error.message) + '</div>' +
      '<div class="actions"><button class="button" id="retry-assignment">Try again</button></div></section>'
  );
  document.getElementById("retry-assignment").addEventListener("click", continueMain);
}

async function prepareSetBreak(afterTrial) {
  const setId = afterTrial / CONFIG.trialsPerSet;
  if (state.checkpointedSets.includes(setId)) {
    renderBreak(afterTrial);
    return;
  }
  setHeader("Saving set", true);
  setView(
    '<section class="card compact-card" aria-busy="true"><h1>Saving Set ' + escapeHtml(String(setId)) + '…</h1>' +
      '<p>Keep this page open while all ' + escapeHtml(String(afterTrial)) + ' submitted responses are confirmed.</p></section>'
  );
  try {
    await flushUploads();
    if (!isPreview) {
      const checkpoint = await jsonp(CONFIG.dataEndpoint, {
        action: "checkpoint",
        participant_id: state.participantId,
        study_id: state.studyId,
        session_id: state.sessionId,
        expected_trials: afterTrial,
        study_version: CONFIG.version
      }, 15000);
      if (!checkpoint?.ok || !checkpoint.complete || Number(checkpoint.confirmedTrials) !== afterTrial) {
        const confirmed = Number(checkpoint?.confirmedTrials || 0);
        throw new Error(`The server confirmed ${confirmed} of ${afterTrial} responses.`);
      }
    }
    state.checkpointedSets.push(setId);
    saveLocal();
    renderBreak(afterTrial);
  } catch (error) {
    setHeader("Save interrupted", true);
    setView(
      '<section class="card compact-card"><h1>Set ' + escapeHtml(String(setId)) + ' is not fully saved yet.</h1>' +
        '<p>Check the connection and retry. The next set will remain locked until all responses are confirmed.</p>' +
        '<div class="notice error">' + escapeHtml(error.message) + '</div>' +
        '<div class="actions"><button class="button" id="retry-checkpoint">Retry save</button></div></section>'
    );
    document.getElementById("retry-checkpoint").addEventListener("click", () => prepareSetBreak(afterTrial));
  }
}

function renderStimulusLoadError(error) {
  recordEvent("stimulus_load_error", { message: error.message, trialCursor: state.trialCursor });
  setHeader("Connection problem", true);
  setView(
    '<section class="card compact-card"><h1>A document did not load.</h1>' +
      '<p>Your progress is saved. Check the connection, then try this trial again.</p>' +
      '<div class="notice error">' + escapeHtml(error.message) + "</div>" +
      '<div class="actions"><button class="button" id="retry-trial">Try again</button></div></section>'
  );
  document.getElementById("retry-trial").addEventListener("click", continueMain);
}

async function runStimulusTrial(trial, doc, attempt) {
  const baselineFile = CONFIG.conditionFiles.D0_plain;
  const enrichedFile = trial.practice ? null : CONFIG.conditionFiles[trial.conditionId];
  const baselineHtml = trial.practice ? doc.html.baseline : doc.html[baselineFile];
  const enrichedHtml = trial.practice ? doc.html.enriched : doc.html[enrichedFile];
  const leftHtml = trial.baselineSide === "left" ? baselineHtml : enrichedHtml;
  const rightHtml = trial.baselineSide === "right" ? baselineHtml : enrichedHtml;

  setView(
    '<div class="trial-shell">' +
      '<div class="stimulus-phase trial-phase" id="stimulus-phase" style="visibility:hidden" aria-hidden="true">' +
        stimulusPanel("left") + stimulusPanel("right") +
      "</div>" +
      '<div class="fixation-phase phase-overlay" id="preparation-phase"><p class="muted">Keep your eyes near the center.</p></div>' +
      '<div class="fixation-phase phase-overlay hidden" id="fixation-phase" aria-label="Fixation cross"><div class="fixation-cross">+</div></div>' +
    "</div>",
    { fullBleed: true }
  );

  const stimulusPhase = document.getElementById("stimulus-phase");
  const leftFrame = document.getElementById("frame-left");
  const rightFrame = document.getElementById("frame-right");
  const sourceWidth = doc.viewport_width || 900;
  const sourceHeight = doc.viewport_height || 1200;
  primeStimulusFrame(leftFrame, sourceWidth, sourceHeight);
  primeStimulusFrame(rightFrame, sourceWidth, sourceHeight);
  const preparationStarted = performance.now();
  const invalidation = { hidden: false, resized: false };
  let timingPhase = "preload";
  const visibilityListener = () => {
    if (document.visibilityState !== "visible" && ["fixation", "exposure"].includes(timingPhase)) invalidation.hidden = true;
  };
  const resizeListener = () => {
    if (["fixation", "exposure"].includes(timingPhase)) invalidation.resized = true;
  };
  document.addEventListener("visibilitychange", visibilityListener);
  window.addEventListener("resize", resizeListener);

  try {
    await Promise.all([
      loadFrame(leftFrame, prepareSrcdoc(leftHtml)),
      loadFrame(rightFrame, prepareSrcdoc(rightHtml))
    ]);
    await nextFrame();
    const leftMeasuredHeight = measureFrameContentHeight(leftFrame);
    const rightMeasuredHeight = measureFrameContentHeight(rightFrame);
    const leftContentHeight = resolveMeasuredHeight(leftMeasuredHeight, sourceHeight);
    const rightContentHeight = resolveMeasuredHeight(rightMeasuredHeight, sourceHeight);
    const fittedContentHeight = choosePairContentHeight({
      leftMeasuredHeight,
      rightMeasuredHeight,
      sourceHeight
    });
    const scale = fitStimuli(sourceWidth, fittedContentHeight);
    const preloadMs = performance.now() - preparationStarted;
    document.getElementById("preparation-phase").classList.add("hidden");
    const fixation = document.getElementById("fixation-phase");
    fixation.classList.remove("hidden");
    timingPhase = "fixation";
    await sleep(timings.fixationMs);
    if (invalidation.hidden || invalidation.resized) {
      throw new TrialTimingError("The window changed during fixation.", { ...invalidation, phase: "fixation" });
    }

    fixation.classList.add("hidden");
    stimulusPhase.style.visibility = "visible";
    stimulusPhase.setAttribute("aria-hidden", "false");
    await nextFrame();
    await nextFrame();
    const onset = performance.now();
    timingPhase = "exposure";
    await sleep(timings.exposureMs);
    const offset = performance.now();
    stimulusPhase.style.visibility = "hidden";
    stimulusPhase.setAttribute("aria-hidden", "true");
    timingPhase = "complete";
    const actualExposureMs = offset - onset;
    const metrics = {
      attempt,
      plannedFixationMs: timings.fixationMs,
      plannedExposureMs: timings.exposureMs,
      actualExposureMs,
      preloadMs,
      scale,
      fittedContentHeight,
      leftContentHeight,
      rightContentHeight,
      trimmedBottomWhitespacePx: Math.max(0, sourceHeight - fittedContentHeight),
      invalidation,
      fullscreen: Boolean(document.fullscreenElement),
      screen: collectScreenInfo()
    };
    if (invalidation.hidden || invalidation.resized || actualExposureMs > timings.exposureMs + 120) {
      throw new TrialTimingError("The timed display was interrupted.", metrics);
    }
    renderRating(trial, doc, metrics);
  } catch (error) {
    const detail = error.metrics || { message: error.message, attempt };
    recordEvent("trial_attempt_discarded", {
      docId: trial.docId,
      trialOrder: trial.trialOrder,
      practice: Boolean(trial.practice),
      detail
    });
    renderTrialRetry(trial, doc, attempt, error.message);
  } finally {
    document.removeEventListener("visibilitychange", visibilityListener);
    window.removeEventListener("resize", resizeListener);
  }
}

class TrialTimingError extends Error {
  constructor(message, metrics) {
    super(message);
    this.metrics = metrics;
  }
}

function stimulusPanel(side) {
  return '<div class="stimulus-panel" id="panel-' + side + '"><span class="stimulus-label">' + side.toUpperCase() +
    '</span><div class="stimulus-holder" id="holder-' + side + '"><iframe id="frame-' + side +
    '" title="' + side + ' article version" sandbox="allow-same-origin" tabindex="-1"></iframe></div></div>';
}

function prepareSrcdoc(html) {
  const clean = String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, "")
    .replace(/<base\b[^>]*>/gi, "");
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">';
  return clean.includes("<head>") ? clean.replace("<head>", "<head>" + policy) : policy + clean;
}

function loadFrame(frame, srcdoc) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Stimulus rendering timed out.")), 12000);
    frame.addEventListener("load", async () => {
      try {
        await frame.contentDocument?.fonts?.ready;
      } catch (_) {
        // Font readiness is an enhancement; the iframe load event remains the fallback.
      }
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
    frame.srcdoc = srcdoc;
  });
}

function primeStimulusFrame(frame, width, height) {
  frame.style.width = String(width) + "px";
  frame.style.height = String(height) + "px";
  frame.style.transform = "none";
}

function measureFrameContentHeight(frame) {
  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument?.body || !frameWindow) return null;

  const preferred = Array.from(frameDocument.querySelectorAll(
    ".document-container, .doc, main, article, [role='document']"
  ));
  const candidates = preferred.length ? preferred : Array.from(frameDocument.body.children);
  let contentBottom = 0;

  candidates.forEach((element) => {
    const style = frameWindow.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.bottom)) return;
    contentBottom = Math.max(contentBottom, rect.bottom);
  });

  return contentBottom > 0 ? Math.ceil(contentBottom) : null;
}

function fitStimuli(width, height) {
  const panels = ["left", "right"].map((side) => document.getElementById("panel-" + side));
  const availableWidth = Math.min(...panels.map((panel) => panel.clientWidth - 24));
  const availableHeight = Math.min(...panels.map((panel) => panel.clientHeight - 24));
  const fit = calculateStimulusFit({
    sourceWidth: width,
    contentHeight: height,
    availableWidth,
    availableHeight
  });
  ["left", "right"].forEach((side) => {
    const holder = document.getElementById("holder-" + side);
    const frame = document.getElementById("frame-" + side);
    holder.style.width = String(fit.renderedWidth) + "px";
    holder.style.height = String(fit.renderedHeight) + "px";
    frame.style.width = String(width) + "px";
    frame.style.height = String(height) + "px";
    frame.style.transform = "scale(" + String(fit.scale) + ")";
  });
  return fit.scale;
}

function renderTrialRetry(trial, doc, attempt, message) {
  setHeader(trial.practice ? "Practice" : "Main study", !trial.practice);
  setView(
    '<section class="card compact-card"><h1>The timed display was interrupted.</h1>' +
      '<p>This attempt will not be analyzed. Keep the tab active and the window unchanged, then repeat the same trial.</p>' +
      '<div class="notice">' + escapeHtml(message) + "</div>" +
      '<div class="actions"><button class="button" id="repeat-trial">Repeat trial</button></div></section>'
  );
  document.getElementById("repeat-trial").addEventListener("click", () => {
    runStimulusTrial(trial, doc, attempt + 1);
  });
}

function renderRating(trial, doc, metrics) {
  const ratingShownAt = performance.now();
  setView(
    '<div class="trial-shell"><div class="rating-phase"><section class="card rating-card">' +
      '<h1>Which version would motivate you more to continue reading, based on its visual appearance?</h1>' +
      '<p class="muted">Choose a direction and strength. Select 0 if there was no difference.</p>' +
      '<div class="rating-scale" role="group" aria-label="Preference from left to right">' +
        [-3, -2, -1, 0, 1, 2, 3].map((value) => '<button class="rating-option" data-value="' + value + '" aria-label="' +
          spatialLabel(value) + '">' + (value > 0 ? "+" : "") + value + "</button>").join("") +
      "</div>" +
      '<div class="rating-anchors"><span>LEFT much more</span><span>No difference</span><span>RIGHT much more</span></div>' +
      '<div class="actions center"><button class="button" id="submit-rating" disabled>Submit rating</button></div>' +
    "</section></div></div>",
    { fullBleed: true }
  );
  let selected = null;
  document.querySelectorAll(".rating-option").forEach((button) => {
    button.addEventListener("click", () => {
      selected = Number(button.dataset.value);
      document.querySelectorAll(".rating-option").forEach((item) => item.classList.toggle("selected", item === button));
      document.getElementById("submit-rating").disabled = false;
    });
  });
  document.getElementById("submit-rating").addEventListener("click", () => {
    const responseTimeMs = performance.now() - ratingShownAt;
    if (trial.practice) {
      recordEvent("practice_response", { practiceIndex: state.practiceIndex, spatialRating: selected, responseTimeMs });
      state.practiceIndex += 1;
      saveLocal();
      runPracticeTrial();
      return;
    }
    const normalizedRating = trial.enrichedSide === "right" ? selected : -selected;
    const conditionMeta = doc.condition_meta?.[trial.conditionId] || {};
    const record = {
      eventId: makeEventId("trial", trial.allocationId + ":" + trial.globalTrialIndex),
      participantId: state.participantId,
      studyId: state.studyId,
      sessionId: state.sessionId,
      participantSlot: state.slot,
      allocationId: trial.allocationId,
      setId: trial.setId,
      setTrialIndex: trial.setTrialIndex,
      globalTrialIndex: trial.globalTrialIndex,
      documentId: trial.docId,
      sourceDocumentId: doc.source_document_id || null,
      validationStatus: doc.validation_status || null,
      conditionId: trial.conditionId,
      enrichedFile: trial.enrichedFile,
      degreeValue: trial.degreeValue,
      visualCoverage: conditionMeta.ink_mass_ratio ?? null,
      targetCoverage: conditionMeta.target_ink_mass_ratio ?? null,
      retainedFactorCount: conditionMeta.retained_factor_count ?? null,
      baselineSide: trial.baselineSide,
      enrichedSide: trial.enrichedSide,
      documentExposureNumber: trial.documentExposureNumber,
      randomizationSeed: trial.randomizationSeed,
      spatialRating: selected,
      rating: normalizedRating,
      responseTime: responseTimeMs,
      plannedFixationMs: metrics.plannedFixationMs,
      plannedExposureMs: metrics.plannedExposureMs,
      actualExposureMs: metrics.actualExposureMs,
      preloadMs: metrics.preloadMs,
      attemptCount: metrics.attempt,
      stimulusScale: metrics.scale,
      sourceViewportWidth: doc.viewport_width,
      sourceViewportHeight: doc.viewport_height,
      fittedContentHeight: metrics.fittedContentHeight,
      leftContentHeight: metrics.leftContentHeight,
      rightContentHeight: metrics.rightContentHeight,
      trimmedBottomWhitespacePx: metrics.trimmedBottomWhitespacePx,
      fullscreen: metrics.fullscreen,
      displayInfo: metrics.screen,
      respondedAt: nowIso()
    };
    state.trialCursor += 1;
    state.status = "in_progress";
    queueRemote("trial", { record });
    saveLocal();
    continueMain();
  });
}

function spatialLabel(value) {
  if (value === 0) return "No difference";
  const direction = value < 0 ? "left" : "right";
  const strength = Math.abs(value) === 3 ? "much more" : Math.abs(value) === 2 ? "more" : "slightly more";
  return direction + " version " + strength;
}

function renderAttentionCheck(afterTrial) {
  const instructedResponse = expectedAttentionResponse(afterTrial, CONFIG.attentionChecks);
  const displayResponse = (instructedResponse > 0 ? "+" : "") + String(instructedResponse);
  setHeader("Attention check", true);
  setView(
    '<section class="card compact-card"><h1>Please follow the instruction below.</h1>' +
      '<div class="attention-box"><strong>This is an attention check. To show that you are reading carefully, select “' + displayResponse + '” below.</strong></div>' +
      '<div class="rating-scale" role="group" aria-label="Attention-check response">' +
        [-3, -2, -1, 0, 1, 2, 3].map((value) => '<button class="rating-option" data-value="' + value + '">' +
          (value > 0 ? "+" : "") + value + "</button>").join("") +
      "</div>" +
      '<div class="rating-anchors"><span>LEFT much more</span><span>No difference</span><span>RIGHT much more</span></div>' +
      '<div class="notice error hidden" id="attention-error" role="alert"></div>' +
      '<div class="actions right"><button class="button" id="submit-attention" disabled>Submit</button></div></section>'
  );
  let selected = null;
  let attempt = Number(state.attentionAttempts[afterTrial] || 0);
  document.querySelectorAll(".rating-option").forEach((button) => {
    button.addEventListener("click", () => {
      selected = Number(button.dataset.value);
      document.querySelectorAll(".rating-option").forEach((item) => item.classList.toggle("selected", item === button));
      document.getElementById("submit-attention").disabled = false;
    });
  });
  document.getElementById("submit-attention").addEventListener("click", () => {
    attempt += 1;
    state.attentionAttempts[afterTrial] = attempt;
    saveLocal();
    const passed = selected === instructedResponse;
    const result = {
      eventId: makeEventId("attention", String(afterTrial) + ":" + String(attempt)),
      afterTrial,
      setId: Math.floor((afterTrial - 1) / CONFIG.trialsPerSet) + 1,
      attempt,
      instructedResponse,
      response: selected,
      passed,
      answeredAt: nowIso()
    };
    queueRemote("event", { event: Object.assign({ type: "attention_check" }, result) });
    if (!passed) {
      const error = document.getElementById("attention-error");
      error.textContent = "That response was incorrect. Please select " + displayResponse + " as instructed.";
      error.classList.remove("hidden");
      selected = null;
      document.querySelectorAll(".rating-option").forEach((item) => item.classList.remove("selected"));
      document.getElementById("submit-attention").disabled = true;
      return;
    }
    state.attentionChecks.push(result);
    saveLocal();
    continueMain();
  });
}

function renderBreak(afterTrial) {
  const setId = afterTrial / CONFIG.trialsPerSet;
  let breakRecord = state.breaks.find((item) => item.afterTrial === afterTrial);
  if (!breakRecord) {
    breakRecord = { afterTrial, setId, startedAt: nowIso(), completedAt: null };
    state.breaks.push(breakRecord);
    saveLocal();
    recordEvent("break_started", { setId, afterTrial, minimumBreakMs: CONFIG.minimumBreakMs });
  }
  setHeader("Break", true);
  setView(
    '<section class="card compact-card"><h1>Take a 60-second break.</h1>' +
      '<p>You completed Set ' + escapeHtml(String(setId)) + ' of 3 (' + escapeHtml(String(afterTrial)) + ' of 114 comparisons). Rest your eyes before starting the next set.</p>' +
      '<p class="break-countdown" id="break-countdown" aria-live="polite"></p>' +
      '<div class="actions"><button class="button" id="continue-after-break" disabled>Continue to Set ' + escapeHtml(String(setId + 1)) + '</button></div></section>'
  );
  const button = document.getElementById("continue-after-break");
  const countdown = document.getElementById("break-countdown");
  const started = Date.parse(breakRecord.startedAt);
  let timer = null;
  const update = () => {
    const remaining = remainingBreakMs(breakRecord.startedAt, Date.now(), minimumBreakMs);
    countdown.textContent = remaining > 0
      ? `You can continue in ${Math.ceil(remaining / 1000)} seconds.`
      : "The break is complete. Continue when you are ready.";
    button.disabled = remaining > 0;
    if (remaining <= 0 && timer) window.clearInterval(timer);
  };
  timer = window.setInterval(update, 250);
  update();
  button.addEventListener("click", () => {
    if (Date.now() - started < minimumBreakMs) return;
    window.clearInterval(timer);
    breakRecord.completedAt = nowIso();
    saveLocal();
    recordEvent("break_completed", { setId, afterTrial, elapsedMs: Date.now() - started });
    queueRemote("snapshot", { reason: `break-${setId}-completed` });
    continueMain();
  });
}

function renderPostStudy() {
  setHeader("Final questions", true);
  setView(
    '<section class="card compact-card"><h1>Final check</h1>' +
      '<form id="post-form" class="question-stack">' +
        '<div class="question"><fieldset><legend>Did you experience a technical problem that may have affected the timed displays?</legend>' +
          '<label class="radio-row"><input type="radio" name="technical" value="no" required><span>No</span></label>' +
          '<label class="radio-row"><input type="radio" name="technical" value="yes"><span>Yes</span></label></fieldset></div>' +
        '<div class="question"><label for="comment"><strong>Optional comment</strong></label><textarea id="comment" rows="3" maxlength="800" placeholder="Briefly describe any issue or feedback."></textarea></div>' +
        '<div class="actions right"><button class="button" type="submit">Continue to submit</button></div>' +
      "</form></section>"
  );
  document.getElementById("post-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.postStudy = {
      technicalProblem: form.get("technical"),
      comment: document.getElementById("comment").value.trim(),
      answeredAt: nowIso()
    };
    state.status = "ready_to_submit";
    saveLocal();
    renderSubmit();
  });
}

function renderSubmit() {
  setHeader("Ready to submit", true);
  setView(
    '<section class="card compact-card"><h1>You completed the task.</h1>' +
      '<p>You completed ' + escapeHtml(String(state.trialCursor)) + ' comparisons. Select Submit to save the final record and return to Prolific.</p>' +
      '<div class="notice">Keep this page open until the Prolific page appears.</div>' +
      '<div class="actions"><button class="button" id="final-submit">Submit study</button></div></section>'
  );
  document.getElementById("final-submit").addEventListener("click", submitFinal);
}

async function submitFinal() {
  const button = document.getElementById("final-submit") || document.getElementById("retry-final");
  if (!finalStateIsComplete(state, CONFIG)) {
    setView(
      '<section class="card compact-card"><h1>The study record is incomplete.</h1>' +
        '<p>The task cannot be submitted until all trials, attention checks, and required breaks are complete.</p>' +
        '<div class="actions"><button class="button" id="return-to-study">Return to study</button></div></section>'
    );
    document.getElementById("return-to-study").addEventListener("click", continueMain);
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  const outcome = "complete";
  const finalEventId = makeEventId("final", outcome);
  state.status = outcome;
  state.completedAt = nowIso();
  saveLocal();
  queueRemote("final", {
    finalEventId,
    outcome,
    summary: {
      completedTrials: state.trialCursor,
      attentionChecksPassed: state.attentionChecks.length,
      postStudy: state.postStudy,
      completedAt: state.completedAt
    }
  });
  try {
    await flushUploads();
    if (!isPreview) {
      const confirmation = await jsonp(CONFIG.dataEndpoint, {
        action: "confirm",
        participant_id: state.participantId,
        study_id: state.studyId,
        session_id: state.sessionId,
        event_id: finalEventId,
        study_version: CONFIG.version
      }, 12000);
      if (!confirmation?.ok || !confirmation.confirmed || Number(confirmation.trialCount) !== CONFIG.trialCount) {
        throw new Error("The final save and all 114 trial rows could not be confirmed.");
      }
    }
    state.status = "complete";
    saveLocal();
    if (isPreview) {
      renderPreviewComplete();
      return;
    }
    redirectTo(CONFIG.redirects.complete);
  } catch (error) {
    state.status = "upload_error";
    saveLocal();
    setHeader("Save interrupted", true);
    setView(
      '<section class="card compact-card"><h1>Your final save was not confirmed.</h1>' +
        '<p>Your responses remain stored on this device. Check the connection and retry; do not close the page.</p>' +
        '<div class="notice error">' + escapeHtml(error.message) + "</div>" +
        '<div class="actions"><button class="button" id="retry-final">Retry final save</button></div></section>'
    );
    document.getElementById("retry-final").addEventListener("click", submitFinal);
  }
}

function renderPreviewComplete() {
  setHeader("Preview complete", true);
  setView(
    '<section class="card compact-card"><h1>Preview completed successfully.</h1>' +
      '<p>No Prolific redirect occurred, no remote data was written, and no participant-facing log is available in preview mode.</p>' +
      '<div class="actions"><button class="button" id="reset-preview">Reset preview</button></div></section>'
  );
  document.getElementById("reset-preview").addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    window.location.reload();
  });
}

function renderResume() {
  setHeader("Saved progress found");
  setView(
    '<section class="card compact-card"><h1>Continue where you left off?</h1>' +
      '<p>This device has saved progress for ' + escapeHtml(String(state.trialCursor)) + ' of ' +
      escapeHtml(String(CONFIG.trialCount)) + ' main comparisons.</p>' +
      '<div class="actions"><button class="button" id="resume-button">Resume</button>' +
      (isPreview ? '<button class="button secondary" id="restart-button">Restart preview</button>' : "") +
      "</div></section>"
  );
  document.getElementById("resume-button").addEventListener("click", async () => {
    try {
      assignment = await loadCurrentAssignment(Number(state.slot));
      await requestStudyFullscreen();
      if (!state.practiceComplete) renderPracticeIntro();
      else continueMain();
    } catch (error) {
      renderAssignmentLoadError(error);
    }
  });
  document.getElementById("restart-button")?.addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    window.location.reload();
  });
}

function renderAlreadyComplete() {
  setHeader("Already complete");
  setView(
    '<section class="card compact-card"><h1>This session was already completed.</h1>' +
      '<p>Return to Prolific to view the submission.</p>' +
      '<div class="actions"><button class="button" id="return-complete">Return to Prolific</button>' +
      (isPreview ? '<button class="button secondary" id="reset-preview">Reset preview</button>' : "") +
      "</div></section>"
  );
  document.getElementById("return-complete").addEventListener("click", () => redirectTo(CONFIG.redirects.complete));
  document.getElementById("reset-preview")?.addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    window.location.reload();
  });
}

async function terminateEarly(status, reason, redirectKey) {
  state.status = status;
  state.completedAt = nowIso();
  saveLocal();
  if (CONFIG.dataEndpoint && !isPreview) {
    queueRemote("screenout", { reason, outcome: status });
    try { await flushUploads(); } catch (error) { console.warn(error); }
  }
  setHeader("Eligibility result");
  setView(
    '<section class="card compact-card"><h1>This study is not a match for you.</h1>' +
      '<p>Thank you for completing the brief eligibility section. You will now return to Prolific, where the configured screen-out payment will be applied.</p>' +
      '<div class="actions"><button class="button" id="screenout-return">Return to Prolific</button></div></section>'
  );
  const destination = CONFIG.redirects[redirectKey] || CONFIG.redirects.screenedOut;
  document.getElementById("screenout-return").addEventListener("click", () => redirectTo(destination));
  window.setTimeout(() => redirectTo(destination), timings.redirectDelayMs);
}

function queueRemote(kind, body = {}) {
  if (!CONFIG.dataEndpoint || isPreview) return;
  const id = body.record?.eventId || body.event?.eventId || body.finalEventId || makeEventId(kind, String(Date.now()));
  if (state.pendingUploads.some((item) => item.id === id)) return;
  const payload = {
    kind,
    studyVersion: CONFIG.version,
    participant: {
      participantId: state.participantId,
      studyId: state.studyId,
      sessionId: state.sessionId,
      slot: state.slot,
      allocationId: state.allocationId,
      assignmentVersion: state.assignmentVersion
    },
    participantSummary: participantSummary(),
    resumeState: resumableState(),
    ...body
  };
  state.pendingUploads.push({ id, payload });
  saveLocal();
  flushUploads().catch(() => {});
}

function participantSummary() {
  return {
    status: state.status,
    consentedAt: state.consentedAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastSeenAt: nowIso(),
    completedTrials: state.trialCursor,
    attentionChecksPassed: state.attentionChecks.length,
    eligibility: state.eligibility,
    colorTest: state.colorTest,
    comprehension: state.comprehension,
    device: state.screen
  };
}

function resumableState() {
  return {
    version: state.version,
    status: state.status,
    consentedAt: state.consentedAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    slot: state.slot,
    allocationId: state.allocationId,
    assignmentVersion: state.assignmentVersion,
    eligibility: state.eligibility,
    colorTest: state.colorTest,
    comprehension: state.comprehension,
    screen: state.screen,
    practiceIndex: state.practiceIndex,
    practiceComplete: state.practiceComplete,
    trialCursor: state.trialCursor,
    attentionChecks: state.attentionChecks,
    attentionAttempts: state.attentionAttempts,
    eventSequence: state.eventSequence || 0,
    breaks: state.breaks,
    checkpointedSets: state.checkpointedSets,
    postStudy: state.postStudy
  };
}

async function flushUploads() {
  if (!CONFIG.dataEndpoint || isPreview) return;
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    let attempts = 0;
    while (state.pendingUploads.length) {
      const item = state.pendingUploads[0];
      try {
        const body = new URLSearchParams({ payload: JSON.stringify(item.payload) });
        await fetch(CONFIG.dataEndpoint, {
          method: "POST",
          mode: "no-cors",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body
        });
        if (["trial", "event"].includes(item.payload.kind)) {
          const confirmation = await jsonp(CONFIG.dataEndpoint, {
            action: "confirm_record",
            record_type: item.payload.kind,
            participant_id: state.participantId,
            study_id: state.studyId,
            session_id: state.sessionId,
            event_id: item.id,
            study_version: CONFIG.version
          }, 10000);
          if (!confirmation?.ok || !confirmation.confirmed) {
            throw new Error(`The ${item.payload.kind} record was not confirmed.`);
          }
        }
        state.pendingUploads.shift();
        attempts = 0;
        saveLocal();
      } catch (error) {
        attempts += 1;
        if (attempts >= 3) throw error;
        await sleep(400 * attempts);
      }
    }
  })();
  try {
    await activeFlush;
  } finally {
    activeFlush = null;
  }
}

function jsonp(endpoint, query, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const callback = "__te_callback_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The data service did not respond."));
    }, timeoutMs);
    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callback];
    }
    window[callback] = (value) => {
      cleanup();
      resolve(value);
    };
    const url = new URL(endpoint);
    Object.entries({ ...query, callback }).forEach(([key, value]) => url.searchParams.set(key, String(value ?? "")));
    script.src = url.toString();
    script.onerror = () => {
      cleanup();
      reject(new Error("The data service could not be reached."));
    };
    document.head.appendChild(script);
  });
}

function redirectTo(url) {
  if (url) {
    window.location.assign(url);
    return;
  }
  if (isPreview) {
    renderPreviewComplete();
    return;
  }
  renderConfigurationError(["The required Prolific redirect URL is missing."]);
}

window.addEventListener("online", () => {
  recordEvent("connection_online");
  flushUploads().catch(() => {});
});
window.addEventListener("offline", () => recordEvent("connection_offline"));
window.addEventListener("beforeunload", () => saveLocal());
document.addEventListener("fullscreenchange", () => {
  if (state.consentedAt) recordEvent(document.fullscreenElement ? "fullscreen_entered" : "fullscreen_exited");
});

init();
