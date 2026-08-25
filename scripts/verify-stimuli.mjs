import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stimuliDir = path.join(root, "stimuli");
const manifestPath = path.join(stimuliDir, "index.json");
const writeManifest = process.argv.includes("--write");
const expectedFiles = [
  "D0_plain.html",
  "D1_derived.html",
  "D2_derived.html",
  "W_writer_optimal.html",
  "D3_derived.html",
  "D4_derived.html",
  "D5_maximal.html"
];
const files = (await fs.readdir(stimuliDir))
  .filter((name) => /^P\d+_DOC_[AB]\.json$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (files.length !== 38) throw new Error("Expected 38 stimulus JSON files, found " + files.length);

const manifest = [];
for (const filename of files) {
  const raw = await fs.readFile(path.join(stimuliDir, filename), "utf8");
  const data = JSON.parse(raw);
  const missing = expectedFiles.filter((key) => !data.html?.[key]);
  if (missing.length) throw new Error(data.doc_id + " missing " + missing.join(", "));
  if (data.viewport_width !== 900 || !Number.isFinite(data.viewport_height)) {
    throw new Error(data.doc_id + " has invalid viewport metadata");
  }
  if (data.source_folder !== "Google Drive/final output") {
    throw new Error(data.doc_id + " does not identify Google Drive/final output as its source");
  }
  for (const [key, html] of Object.entries(data.html)) {
    if (!/^<!DOCTYPE html>/i.test(html.trim())) throw new Error(data.doc_id + "/" + key + " is not complete HTML");
    if (/<script\b/i.test(html)) throw new Error(data.doc_id + "/" + key + " contains a script");
    if (/<(img|link)\b[^>]+(?:src|href)=["']https?:/i.test(html)) {
      throw new Error(data.doc_id + "/" + key + " contains an external resource");
    }
    const conditionId = key.replace(/\.html$/, "");
    const sourceHash = data.source_html_sha256?.[conditionId];
    const actualHash = crypto.createHash("sha256").update(html).digest("hex");
    if (!sourceHash || sourceHash !== actualHash) {
      throw new Error(data.doc_id + "/" + key + " does not match its final-output source hash");
    }
  }
  manifest.push({
    doc_id: data.doc_id,
    original_filename: data.original_filename,
    source_document_id: data.source_document_id,
    viewport_width: data.viewport_width,
    viewport_height: data.viewport_height,
    validation_status: data.validation_status,
    source_pipeline_version: data.source_pipeline_version,
    source_folder: data.source_folder,
    source_html_sha256: data.source_html_sha256,
    condition_meta: data.condition_meta,
    sha256: crypto.createHash("sha256").update(raw).digest("hex")
  });
}

const nextManifest = {
    generated_at: new Date().toISOString(),
    source: "Google Drive/final output",
    document_count: manifest.length,
    enriched_conditions_per_document: 6,
    documents: manifest
};

if (writeManifest) {
  await fs.writeFile(manifestPath, JSON.stringify(nextManifest, null, 2) + "\n");
} else {
  const currentManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const currentComparable = { ...currentManifest, generated_at: "" };
  const nextComparable = { ...nextManifest, generated_at: "" };
  if (JSON.stringify(currentComparable) !== JSON.stringify(nextComparable)) {
    throw new Error("stimuli/index.json is stale; run npm run refresh-stimuli-manifest and commit the result");
  }
}

const warnings = manifest.filter((item) => item.validation_status !== "pass").map((item) => item.doc_id);
console.log(JSON.stringify({
  documents: manifest.length,
  html_files: manifest.length * expectedFiles.length,
  pass: manifest.length - warnings.length,
  warnings,
  manifest: writeManifest ? "updated" : "verified"
}, null, 2));
