import assert from "node:assert/strict";
import { expectedAttentionResponse } from "../attention.js";

const schedule = [12, 26];
assert.equal(expectedAttentionResponse(12, schedule), 1);
assert.equal(expectedAttentionResponse(26, schedule), 3);
assert.throws(() => expectedAttentionResponse(19, schedule), /Unknown attention-check position/);

console.log("Attention-check answers verified: first +1; second +3.");
