export function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seedText) {
  const output = [...items];
  const random = mulberry32(hashString(seedText));
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function buildAssignment({ participantSlot, participantId, docIds, conditionOrder, assignmentSeed }) {
  if (!Number.isInteger(participantSlot) || participantSlot < 1 || participantSlot > 30) {
    throw new Error("participantSlot must be an integer from 1 to 30");
  }
  if (docIds.length !== 38 || conditionOrder.length !== 6) {
    throw new Error("Expected 38 documents and 6 enriched conditions");
  }

  const cohort = Math.floor((participantSlot - 1) / 6);
  const cohortPosition = (participantSlot - 1) % 6;
  const fixedDocumentOrder = seededShuffle([...docIds].sort(), `${assignmentSeed}:documents`);

  const assigned = fixedDocumentOrder.map((docId, assignmentSlot) => {
    const conditionIndex = (cohortPosition + assignmentSlot + cohort) % conditionOrder.length;
    const baselineLeft = (cohort + assignmentSlot) % 2 === 0;
    return {
      docId,
      assignmentSlot,
      conditionId: conditionOrder[conditionIndex],
      conditionIndex,
      cohort,
      cohortPosition,
      baselineSide: baselineLeft ? "left" : "right",
      enrichedSide: baselineLeft ? "right" : "left"
    };
  });

  const trialSeed = `${assignmentSeed}:participant:${participantId || `slot-${participantSlot}`}`;
  return {
    cohort,
    cohortPosition,
    fixedDocumentOrder,
    trialSeed,
    trials: seededShuffle(assigned, trialSeed).map((trial, trialOrder) => ({ ...trial, trialOrder }))
  };
}
