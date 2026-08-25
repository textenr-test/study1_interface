export function nextStudyAction(state, config) {
  const completed = Number(state.trialCursor || 0);
  const attentionChecks = Array.isArray(state.attentionChecks) ? state.attentionChecks : [];
  const breaks = Array.isArray(state.breaks) ? state.breaks : [];
  const attentionDue = config.attentionChecks.find((check) => (
    completed >= check.afterTrial
      && !attentionChecks.some((item) => item.afterTrial === check.afterTrial && item.passed)
  ));
  if (attentionDue) return { type: "attention", afterTrial: attentionDue.afterTrial };
  const breakDue = config.breakAfterTrials.find((afterTrial) => (
    completed >= afterTrial
      && !breaks.some((item) => item.afterTrial === afterTrial && item.completedAt)
  ));
  if (breakDue) return { type: "break", afterTrial: breakDue };
  if (completed >= config.trialCount) return { type: "post_study" };
  return { type: "trial", globalTrialIndex: completed + 1 };
}

export function remainingBreakMs(startedAt, nowMs, minimumBreakMs) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return minimumBreakMs;
  return Math.max(0, minimumBreakMs - (nowMs - start));
}

export function finalStateIsComplete(state, config) {
  return state.trialCursor === config.trialCount
    && state.attentionChecks.filter((item) => item.passed).length === config.attentionChecks.length
    && state.breaks.filter((item) => item.completedAt).length === config.breakAfterTrials.length;
}
