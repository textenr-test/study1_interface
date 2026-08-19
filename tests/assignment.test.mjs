import assert from "node:assert/strict";
import { buildAssignment } from "../assignment.js";

const docIds = Array.from({ length: 19 }, (_, index) => [
  "P" + String(index + 1) + "_DOC_A",
  "P" + String(index + 1) + "_DOC_B"
]).flat();
const conditionOrder = [
  "D1_derived",
  "D2_derived",
  "W_writer_optimal",
  "D3_derived",
  "D4_derived",
  "D5_maximal"
];
const assignmentSeed = "text-enrichment-reader-v1";
const pairCounts = new Map();
const conditionCounts = new Map();
const conditionBaselineLeftCounts = new Map();
let totalBaselineLeft = 0;

for (let slot = 1; slot <= 30; slot += 1) {
  const result = buildAssignment({
    participantSlot: slot,
    participantId: "participant-" + slot,
    docIds,
    conditionOrder,
    assignmentSeed
  });
  assert.equal(result.trials.length, 38);
  assert.equal(new Set(result.trials.map((trial) => trial.docId)).size, 38);
  assert.equal(new Set(result.trials.map((trial) => trial.trialOrder)).size, 38);
  assert.equal(result.trials.filter((trial) => trial.baselineSide === "left").length, 19);
  const perReader = new Map();
  for (const trial of result.trials) {
    const pairKey = trial.docId + "::" + trial.conditionId;
    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
    conditionCounts.set(trial.conditionId, (conditionCounts.get(trial.conditionId) || 0) + 1);
    perReader.set(trial.conditionId, (perReader.get(trial.conditionId) || 0) + 1);
    if (trial.baselineSide === "left") {
      totalBaselineLeft += 1;
      conditionBaselineLeftCounts.set(
        trial.conditionId,
        (conditionBaselineLeftCounts.get(trial.conditionId) || 0) + 1
      );
    }
  }
  for (const count of perReader.values()) assert.ok(count === 6 || count === 7);
}

assert.equal(pairCounts.size, 38 * 6);
for (const count of pairCounts.values()) assert.equal(count, 5);
for (const condition of conditionOrder) {
  assert.equal(conditionCounts.get(condition), 190);
  assert.equal(conditionBaselineLeftCounts.get(condition), 95);
}
assert.equal(totalBaselineLeft, 570);
console.log("Assignment balance verified: 1,140 trials; 228 pairs × 5; left/right 570:570.");
