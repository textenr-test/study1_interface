import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("../study-config.js", import.meta.url), "utf8");

assert.match(app, /plateCard\(0, "Plate 2"\)/);
assert.doesNotMatch(app, /plateCard\(1,/);
assert.match(app, /Instruction &amp; Comprehension Test/);
assert.match(app, /Which version would motivate you more to continue reading, based on its visual appearance\?/);
assert.match(app, /<h1>Main Study<\/h1>/);
assert.match(app, /<h1>You completed the task\.<\/h1>/);
assert.doesNotMatch(app, /downloadPreviewLog|Download preview log|Your first impression|Your responses are ready/);
assert.doesNotMatch(app, /class="eyebrow"/);
assert.match(app, /sandbox="allow-same-origin"/);
assert.match(app, /measureFrameContentHeight/);
assert.match(app, /This study can only be completed on a laptop or desktop computer using a mouse or trackpad\./);
assert.match(app, /Mobile phones and tablets are not supported\./);
assert.match(app, /<span>1,000 ms<\/span>/);
assert.match(app, /comprehensionOption\("duration", "one_second", "About one second"\)/);
assert.doesNotMatch(app, /half_second|About half a second|<span>500 ms<\/span>/);
assert.match(config, /version: "2026-08-20-v6"/);
assert.match(config, /exposureMs: 1000/);
assert.match(css, /\.device-requirement/);
assert.match(css, /--wash: #f7f9fa;/);
assert.match(css, /--paper: #f7f9fa;/);
assert.doesNotMatch(css, /\.eyebrow/);
assert.match(css, /\.actions\.center \{ justify-content: center; \}/);

console.log("Interface copy and privacy controls verified.");
