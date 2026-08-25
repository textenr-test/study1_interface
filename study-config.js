window.STUDY_CONFIG = Object.freeze({
  version: "2026-08-25-v7",
  title: "Visual First-Impression Study",
  targetParticipants: 30,
  trialCount: 114,
  setCount: 3,
  trialsPerSet: 38,
  assignmentVersion: "n30-three-versions-v1",
  assignmentSeed: "text-enrichment-reader-n30-v2",
  conditionOrder: [
    "D1_derived",
    "D2_derived",
    "W_writer_optimal",
    "D3_derived",
    "D4_derived",
    "D5_maximal"
  ],
  conditionFiles: {
    D0_plain: "D0_plain.html",
    D1_derived: "D1_derived.html",
    D2_derived: "D2_derived.html",
    W_writer_optimal: "W_writer_optimal.html",
    D3_derived: "D3_derived.html",
    D4_derived: "D4_derived.html",
    D5_maximal: "D5_maximal.html"
  },
  docIds: [
    "P1_DOC_A", "P1_DOC_B", "P2_DOC_A", "P2_DOC_B", "P3_DOC_A", "P3_DOC_B",
    "P4_DOC_A", "P4_DOC_B", "P5_DOC_A", "P5_DOC_B", "P6_DOC_A", "P6_DOC_B",
    "P7_DOC_A", "P7_DOC_B", "P8_DOC_A", "P8_DOC_B", "P9_DOC_A", "P9_DOC_B",
    "P10_DOC_A", "P10_DOC_B", "P11_DOC_A", "P11_DOC_B", "P12_DOC_A", "P12_DOC_B",
    "P13_DOC_A", "P13_DOC_B", "P14_DOC_A", "P14_DOC_B", "P15_DOC_A", "P15_DOC_B",
    "P16_DOC_A", "P16_DOC_B", "P17_DOC_A", "P17_DOC_B", "P18_DOC_A", "P18_DOC_B",
    "P19_DOC_A", "P19_DOC_B"
  ],
  timings: {
    fixationMs: 750,
    exposureMs: 1000,
    redirectDelayMs: 900
  },
  attentionChecks: [
    { afterTrial: 12, response: 1 },
    { afterTrial: 50, response: 3 },
    { afterTrial: 88, response: 1 }
  ],
  breakAfterTrials: [38, 76],
  minimumBreakMs: 60000,
  device: {
    minimumWidth: 1200,
    minimumHeight: 650,
    allowedPointer: "fine"
  },
  stimulusLanguage: "Korean",
  dataEndpoint: "",
  googleSheetUrl: "",
  redirects: {
    complete: "",
    screenedOut: "",
    noConsent: "",
    failedAttention: "",
    returnSubmission: ""
  },
  researcherContact: "Please contact the researcher through Prolific messaging.",
  supportNote: "If a technical problem prevents completion, message the researcher on Prolific and return the submission rather than submitting incomplete data."
});
