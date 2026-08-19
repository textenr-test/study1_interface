import assert from "node:assert/strict";
import { containsKoreanLanguage } from "../eligibility.js";

for (const value of ["Korean", "English, Korean", "한국어", "한국말", "Hangul"]) {
  assert.equal(containsKoreanLanguage(value), true, `Expected Korean-language match: ${value}`);
}

for (const value of ["English", "Spanish, French", "None", "Koreanic linguistics"]) {
  assert.equal(containsKoreanLanguage(value), false, `Expected no Korean-language match: ${value}`);
}

console.log("Eligibility language screening verified.");
