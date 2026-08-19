import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(app, /plateCard\(0, "Plate 2"\)/);
assert.doesNotMatch(app, /plateCard\(1,/);
assert.match(app, /Instruction &amp; Comprehension Test/);
assert.match(app, /Which version would motivate you more to continue reading, based on its visual appearance\?/);
assert.match(app, /<h1>Main Study<\/h1>/);
assert.match(app, /<h1>You completed the task\.<\/h1>/);
assert.doesNotMatch(app, /downloadPreviewLog|Download preview log|Your first impression|Your responses are ready/);
assert.doesNotMatch(app, /class="eyebrow"/);
assert.match(css, /--wash: #f7f9fa;/);
assert.match(css, /--paper: #f7f9fa;/);
assert.doesNotMatch(css, /\.eyebrow/);
assert.match(css, /\.actions\.center \{ justify-content: center; \}/);

console.log("Interface copy and privacy controls verified.");
