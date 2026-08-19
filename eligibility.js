export function containsKoreanLanguage(value) {
  return /(^|[^a-z])(korean|hangul)([^a-z]|$)|한국어|한국말|조선말/i.test(String(value));
}
