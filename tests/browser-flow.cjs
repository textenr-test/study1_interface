const { chromium } = require("playwright");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });

  await page.goto("http://127.0.0.1:4173/?preview=1&slot=1&fast=1");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: "/tmp/reader-study-consent.png", fullPage: true });
  await page.check("#consent-check");
  await page.click("#consent-button");

  await page.selectOption("#frequency", "weekly");
  await page.check('input[name="language"][value="yes"]');
  await page.check('input[name="vision"][value="yes"]');
  await page.click('#eligibility-form button[type="submit"]');

  await page.fill("#plate-answer-0", "12");
  await page.fill("#plate-answer-1", "6");
  await page.fill("#plate-answer-2", "29");
  await page.screenshot({ path: "/tmp/reader-study-color.png", fullPage: true });
  await page.click('#color-form button[type="submit"]');

  await page.check('input[name="duration"][value="half_second"]');
  await page.check('input[name="judgment"][value="first_impression"]');
  await page.click('#comprehension-form button[type="submit"]');

  await page.click("#start-practice");
  for (let practice = 0; practice < 2; practice += 1) {
    await page.waitForSelector('.rating-option[data-value="0"]', { timeout: 20000 });
    await page.click('.rating-option[data-value="0"]');
    await page.click("#submit-rating");
  }
  await page.click("#begin-main");

  let safety = 0;
  while (safety < 80) {
    safety += 1;
    if (await page.locator("#post-form").count()) break;
    if (await page.locator("#submit-attention").count()) {
      await page.click('.rating-option[data-value="0"]');
      await page.click("#submit-attention");
      continue;
    }
    if (await page.locator("#continue-after-break").count()) {
      await page.click("#continue-after-break");
      continue;
    }
    if (await page.locator("#repeat-trial").count()) {
      await page.click("#repeat-trial");
      continue;
    }
    await page.waitForSelector('.rating-option[data-value="0"]', { timeout: 20000 });
    if (safety === 2) await page.screenshot({ path: "/tmp/reader-study-rating.png", fullPage: true });
    await page.click('.rating-option[data-value="0"]');
    await page.click("#submit-rating");
  }

  if (!(await page.locator("#post-form").count())) throw new Error("Did not reach final questionnaire");
  await page.check('input[name="technical"][value="no"]');
  await page.click('#post-form button[type="submit"]');
  await page.click("#final-submit");
  await page.waitForSelector("#reset-preview", { timeout: 10000 });

  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((value) => value.startsWith("te-reader-study:"));
    return JSON.parse(localStorage.getItem(key));
  });
  if (stored.trialCursor !== 38) throw new Error("Expected 38 trials, found " + stored.trialCursor);
  if (stored.responses.length !== 38) throw new Error("Expected 38 response records");
  if (stored.attentionChecks.length !== 2) throw new Error("Expected two attention checks");
  if (errors.length) throw new Error(errors.join("\n"));

  console.log(JSON.stringify({
    status: stored.status,
    completedTrials: stored.trialCursor,
    responseRecords: stored.responses.length,
    attentionChecks: stored.attentionChecks.length,
    screenshots: [
      path.resolve("/tmp/reader-study-consent.png"),
      path.resolve("/tmp/reader-study-color.png"),
      path.resolve("/tmp/reader-study-rating.png")
    ]
  }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
