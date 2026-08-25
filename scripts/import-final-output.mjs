import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(root, process.argv[2] || "../drive_import");
const targetRoot = path.join(root, "stimuli");
const conditionFiles = [
  "D0_plain.html",
  "D1_derived.html",
  "D2_derived.html",
  "W_writer_optimal.html",
  "D3_derived.html",
  "D4_derived.html",
  "D5_maximal.html"
];

const docIds = (await fs.readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^P\d+_DOC_[AB]$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (docIds.length !== 38) {
  throw new Error(`Expected 38 document folders in ${sourceRoot}; found ${docIds.length}.`);
}

for (const docId of docIds) {
  const sourceDir = path.join(sourceRoot, docId);
  const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
  const manifestConditions = Object.fromEntries(
    (manifest.conditions || []).map((condition) => [condition.condition_id || condition.condition, condition])
  );
  const html = {};
  const sourceHtmlSha256 = {};

  for (const filename of conditionFiles) {
    const conditionId = filename.replace(/\.html$/, "");
    const importedContents = await fs.readFile(path.join(sourceDir, filename), "utf8");
    const expectedHash = manifest.condition_files?.[conditionId]?.html_sha256;
    const candidates = [importedContents, importedContents.replace(/\n$/, "")];
    const contents = candidates.find((candidate) => (
      crypto.createHash("sha256").update(candidate).digest("hex") === expectedHash
    ));
    if (!expectedHash || contents === undefined) {
      throw new Error(`${docId}/${filename} does not match its Drive manifest hash.`);
    }
    const actualHash = crypto.createHash("sha256").update(contents).digest("hex");
    html[filename] = contents;
    sourceHtmlSha256[conditionId] = actualHash;
  }

  const conditionMeta = {};
  for (const conditionId of conditionFiles.map((name) => name.replace(/\.html$/, ""))) {
    const source = manifestConditions[conditionId];
    if (!source) throw new Error(`${docId} is missing condition metadata for ${conditionId}.`);
    conditionMeta[conditionId] = {
      display_order: source.display_order,
      target_ink_mass_ratio: source.target_ink_mass_ratio,
      ink_mass_ratio: source.ink_mass_ratio,
      retained_factor_count: source.retained_factor_count
    };
  }

  const viewport = manifest.fixed_viewport_override || manifest.criteria?.render || {};
  const packaged = {
    doc_id: docId,
    original_filename: manifest.original_filename,
    source_document_id: manifest.document_id,
    source_pipeline_version: manifest.pipeline_version,
    source_folder: "Google Drive/final output",
    viewport_width: viewport.viewport_width_css_px,
    viewport_height: viewport.viewport_height_css_px,
    validation_status: manifest.validation_status,
    source_html_sha256: sourceHtmlSha256,
    condition_meta: conditionMeta,
    html
  };

  if (packaged.viewport_width !== 900 || !Number.isFinite(packaged.viewport_height)) {
    throw new Error(`${docId} has invalid viewport metadata.`);
  }
  await fs.writeFile(
    path.join(targetRoot, `${docId}.json`),
    JSON.stringify(packaged) + "\n"
  );
}

console.log(`Imported ${docIds.length} documents and ${docIds.length * conditionFiles.length} HTML stimuli from Google Drive/final output.`);
