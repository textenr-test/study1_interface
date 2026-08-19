export function expectedAttentionResponse(afterTrial, attentionSchedule) {
  const index = attentionSchedule.indexOf(afterTrial);
  if (index === 0) return 1;
  if (index === 1) return 3;
  throw new Error("Unknown attention-check position");
}
