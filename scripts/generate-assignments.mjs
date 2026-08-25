import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seededShuffle } from "../assignment.js";
import {
  ALLOCATION_HEADERS,
  TRIAL_LOG_COLUMNS,
  TRIAL_LOG_HEADERS,
  TRIAL_LOG_SCHEMA_VERSION
} from "../log-schema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "assignments");
const slotsRoot = path.join(outputRoot, "slots");
const logRoot = path.join(root, "logs");
const STUDY_VERSION = "2026-08-25-v7";
const ASSIGNMENT_VERSION = "n30-three-versions-v1";
const ASSIGNMENT_SEED = "text-enrichment-reader-n30-v2";
const PARTICIPANTS = 30;
const SETS = 3;
const DOCS_PER_SET = 38;
const TRIALS_PER_PARTICIPANT = SETS * DOCS_PER_SET;
const CONDITIONS = [
  "D1_derived",
  "D2_derived",
  "W_writer_optimal",
  "D3_derived",
  "D4_derived",
  "D5_maximal"
];
const DOCUMENTS = Array.from({ length: 19 }, (_, index) => [
  `P${index + 1}_DOC_A`,
  `P${index + 1}_DOC_B`
]).flat();
const BASE_BLOCKS = [
  [0, 1, 2],
  [0, 1, 3],
  [0, 2, 4],
  [0, 3, 5],
  [0, 4, 5],
  [1, 2, 5],
  [1, 3, 4],
  [1, 4, 5],
  [2, 3, 4],
  [2, 3, 5]
];

class Dinic {
  constructor(size) {
    this.graph = Array.from({ length: size }, () => []);
  }

  addEdge(from, to, capacity) {
    const forward = { to, capacity, reverse: this.graph[to].length };
    const reverse = { to: from, capacity: 0, reverse: this.graph[from].length };
    this.graph[from].push(forward);
    this.graph[to].push(reverse);
    return forward;
  }

  maxFlow(source, sink) {
    let total = 0;
    while (true) {
      const level = Array(this.graph.length).fill(-1);
      level[source] = 0;
      const queue = [source];
      for (let head = 0; head < queue.length; head += 1) {
        const node = queue[head];
        for (const edge of this.graph[node]) {
          if (edge.capacity > 0 && level[edge.to] < 0) {
            level[edge.to] = level[node] + 1;
            queue.push(edge.to);
          }
        }
      }
      if (level[sink] < 0) return total;
      const cursor = Array(this.graph.length).fill(0);
      const send = (node, flow) => {
        if (node === sink) return flow;
        for (; cursor[node] < this.graph[node].length; cursor[node] += 1) {
          const edge = this.graph[node][cursor[node]];
          if (edge.capacity <= 0 || level[edge.to] !== level[node] + 1) continue;
          const pushed = send(edge.to, Math.min(flow, edge.capacity));
          if (pushed > 0) {
            edge.capacity -= pushed;
            this.graph[edge.to][edge.reverse].capacity += pushed;
            return pushed;
          }
        }
        return 0;
      };
      while (true) {
        const pushed = send(source, Number.MAX_SAFE_INTEGER);
        if (!pushed) break;
        total += pushed;
      }
    }
  }
}

function buildConditionRows() {
  const rows = [];
  for (let participantIndex = 0; participantIndex < PARTICIPANTS; participantIndex += 1) {
    for (let pairIndex = 0; pairIndex < 19; pairIndex += 1) {
      const shifted = (participantIndex + 10 * pairIndex) % PARTICIPANTS;
      const block = BASE_BLOCKS[shifted % BASE_BLOCKS.length];
      const replica = Math.floor(shifted / BASE_BLOCKS.length);
      const rotation = pairIndex % CONDITIONS.length;
      const first = block.map((condition) => (condition + rotation) % CONDITIONS.length);
      const firstSet = new Set(first);
      const second = Array.from({ length: CONDITIONS.length }, (_, condition) => (
        (condition + rotation) % CONDITIONS.length
      )).filter((condition) => !firstSet.has(condition));

      for (const [suffix, selected] of [["A", first], ["B", second]]) {
        selected.forEach((conditionIndex, position) => {
          const documentId = `P${pairIndex + 1}_DOC_${suffix}`;
          const setId = (replica + position + 2 * pairIndex) % SETS + 1;
          rows.push({
            participantSlot: participantIndex + 1,
            setId,
            documentId,
            documentIndex: DOCUMENTS.indexOf(documentId) + 1,
            conditionId: CONDITIONS[conditionIndex],
            conditionIndex
          });
        });
      }
    }
  }
  return rows;
}

function assignBalancedSides(rows) {
  const groupKeys = Array.from(new Set(rows.map((row) => `${row.participantSlot}:${row.setId}`))).sort();
  const pairKeys = Array.from(new Set(rows.map((row) => `${row.documentId}:${row.conditionId}`))).sort();
  const groupIndex = new Map(groupKeys.map((key, index) => [key, index]));
  const pairIndex = new Map(pairKeys.map((key, index) => [key, index]));
  const source = 0;
  const groupStart = 1;
  const pairStart = groupStart + groupKeys.length;
  const sink = pairStart + pairKeys.length;
  const network = new Dinic(sink + 1);

  groupKeys.forEach((_, index) => network.addEdge(source, groupStart + index, 19));
  pairKeys.forEach((key, index) => {
    const [documentId, conditionId] = key.split(":");
    const documentIndex = DOCUMENTS.indexOf(documentId);
    const conditionIndex = CONDITIONS.indexOf(conditionId);
    const baselineLeftTarget = (documentIndex + conditionIndex) % 2 === 0 ? 8 : 7;
    network.addEdge(pairStart + index, sink, baselineLeftTarget);
  });

  rows.forEach((row) => {
    const groupKey = `${row.participantSlot}:${row.setId}`;
    const pairKey = `${row.documentId}:${row.conditionId}`;
    row._sideEdge = network.addEdge(
      groupStart + groupIndex.get(groupKey),
      pairStart + pairIndex.get(pairKey),
      1
    );
  });

  const required = PARTICIPANTS * SETS * 19;
  const assigned = network.maxFlow(source, sink);
  if (assigned !== required) throw new Error(`Side-balancing flow stopped at ${assigned}/${required}.`);
  rows.forEach((row) => {
    row.baselineSide = row._sideEdge.capacity === 0 ? "left" : "right";
    row.enrichedSide = row.baselineSide === "left" ? "right" : "left";
    delete row._sideEdge;
  });
}

function orderRows(rows) {
  const ordered = [];
  for (let participantSlot = 1; participantSlot <= PARTICIPANTS; participantSlot += 1) {
    const allocationId = `${ASSIGNMENT_VERSION}-slot-${String(participantSlot).padStart(2, "0")}`;
    const baseSeed = `${ASSIGNMENT_SEED}:participant:${participantSlot}:documents`;
    const baseOrder = seededShuffle(DOCUMENTS, baseSeed);
    for (let setId = 1; setId <= SETS; setId += 1) {
      const rotation = (setId - 1) * 13;
      const documentOrder = baseOrder.slice(rotation).concat(baseOrder.slice(0, rotation));
      const setRows = new Map(
        rows
          .filter((row) => row.participantSlot === participantSlot && row.setId === setId)
          .map((row) => [row.documentId, row])
      );
      const randomizationSeed = `${baseSeed}:set:${setId}:rotation:${rotation}`;
      documentOrder.forEach((documentId, index) => {
        const row = setRows.get(documentId);
        if (!row) throw new Error(`Missing slot ${participantSlot}, set ${setId}, ${documentId}.`);
        const setTrialIndex = index + 1;
        ordered.push({
          allocation_id: allocationId,
          participant_id: null,
          participant_slot: participantSlot,
          set_id: setId,
          set_trial_index: setTrialIndex,
          global_trial_index: (setId - 1) * DOCS_PER_SET + setTrialIndex,
          document_id: row.documentId,
          document_index: row.documentIndex,
          condition_id: row.conditionId,
          enriched_file: `${row.conditionId}.html`,
          degree_value: row.conditionIndex + 1,
          baseline_side: row.baselineSide,
          enriched_side: row.enrichedSide,
          document_exposure_number: setId,
          randomization_seed: randomizationSeed,
          rating: null,
          response_time: null,
          assignment_version: ASSIGNMENT_VERSION,
          study_version: STUDY_VERSION
        });
      });
    }
  }
  return ordered;
}

function countBy(records, keyOf) {
  const counts = new Map();
  records.forEach((record) => {
    const key = keyOf(record);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function requireCounts(label, counts, allowed) {
  for (const [key, count] of counts) {
    if (!allowed.includes(count)) throw new Error(`${label} ${key}: expected ${allowed.join("/")}, found ${count}.`);
  }
}

function validate(records) {
  if (records.length !== PARTICIPANTS * TRIALS_PER_PARTICIPANT) {
    throw new Error(`Expected 3,420 allocation rows; found ${records.length}.`);
  }
  requireCounts("participant", countBy(records, (r) => r.participant_slot), [114]);
  requireCounts("participant-set", countBy(records, (r) => `${r.participant_slot}:${r.set_id}`), [38]);
  requireCounts("participant-document", countBy(records, (r) => `${r.participant_slot}:${r.document_id}`), [3]);
  requireCounts("document-set", countBy(records, (r) => `${r.document_id}:${r.set_id}`), [30]);
  requireCounts("participant-condition", countBy(records, (r) => `${r.participant_slot}:${r.condition_id}`), [19]);
  requireCounts("document-condition", countBy(records, (r) => `${r.document_id}:${r.condition_id}`), [15]);
  requireCounts("document-condition-set", countBy(records, (r) => `${r.document_id}:${r.condition_id}:${r.set_id}`), [5]);
  requireCounts("participant-set-condition", countBy(records, (r) => `${r.participant_slot}:${r.set_id}:${r.condition_id}`), [6, 7]);
  requireCounts("participant-set-left", countBy(records.filter((r) => r.baseline_side === "left"), (r) => `${r.participant_slot}:${r.set_id}`), [19]);
  requireCounts("document-condition-left", countBy(records.filter((r) => r.baseline_side === "left"), (r) => `${r.document_id}:${r.condition_id}`), [7, 8]);

  const cooccurrence = new Map();
  for (let participantSlot = 1; participantSlot <= PARTICIPANTS; participantSlot += 1) {
    for (const documentId of DOCUMENTS) {
      const conditions = records
        .filter((r) => r.participant_slot === participantSlot && r.document_id === documentId)
        .map((r) => r.condition_id)
        .sort();
      if (new Set(conditions).size !== 3) throw new Error(`Repeated condition for slot ${participantSlot}, ${documentId}.`);
      for (let left = 0; left < conditions.length; left += 1) {
        for (let right = left + 1; right < conditions.length; right += 1) {
          const key = `${documentId}:${conditions[left]}:${conditions[right]}`;
          cooccurrence.set(key, (cooccurrence.get(key) || 0) + 1);
        }
      }
    }
  }
  requireCounts("document-condition-pair", cooccurrence, [6]);

  for (let participantSlot = 1; participantSlot <= PARTICIPANTS; participantSlot += 1) {
    const setOrders = [1, 2, 3].map((setId) => records
      .filter((r) => r.participant_slot === participantSlot && r.set_id === setId)
      .sort((a, b) => a.set_trial_index - b.set_trial_index)
      .map((r) => r.document_id));
    DOCUMENTS.forEach((documentId) => {
      const positions = setOrders.map((order) => order.indexOf(documentId));
      if (new Set(positions).size !== 3) throw new Error(`Repeated position for slot ${participantSlot}, ${documentId}.`);
    });
    for (let index = 0; index < 2; index += 1) {
      const previousLast = new Set(setOrders[index].slice(-5));
      if (setOrders[index + 1].slice(0, 5).some((doc) => previousLast.has(doc))) {
        throw new Error(`Set-boundary document overlap for slot ${participantSlot}.`);
      }
    }
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers, records) {
  return [headers, ...records.map((record) => headers.map((header) => record[header]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n") + "\n";
}

const conditionRows = buildConditionRows();
assignBalancedSides(conditionRows);
const records = orderRows(conditionRows);
validate(records);

await fs.mkdir(slotsRoot, { recursive: true });
await fs.mkdir(logRoot, { recursive: true });

const allocationHash = sha256(JSON.stringify(records));
const master = {
  schema_version: "text-enrichment-allocation-v2",
  study_version: STUDY_VERSION,
  assignment_version: ASSIGNMENT_VERSION,
  assignment_seed: ASSIGNMENT_SEED,
  participant_slots: PARTICIPANTS,
  sets_per_participant: SETS,
  trials_per_set: DOCS_PER_SET,
  trials_per_participant: TRIALS_PER_PARTICIPANT,
  total_trials: records.length,
  allocation_sha256: allocationHash,
  constraints: {
    participant_document_distinct_conditions: 3,
    participant_condition_total: 19,
    document_condition_readers: 15,
    document_condition_set_readers: 5,
    document_condition_pair_cooccurrence: 6,
    participant_set_condition_frequency: [6, 7],
    participant_set_baseline_side: { left: 19, right: 19 }
  },
  records
};
await fs.writeFile(path.join(outputRoot, "master-assignment.json"), JSON.stringify(master, null, 2) + "\n");
await fs.writeFile(path.join(outputRoot, "master-assignment.csv"), toCsv(ALLOCATION_HEADERS, records));

const slotIndex = [];
for (let participantSlot = 1; participantSlot <= PARTICIPANTS; participantSlot += 1) {
  const trials = records.filter((record) => record.participant_slot === participantSlot);
  const filename = `slot-${String(participantSlot).padStart(2, "0")}.json`;
  const slotHash = sha256(JSON.stringify(trials));
  const payload = {
    schema_version: "text-enrichment-slot-allocation-v2",
    study_version: STUDY_VERSION,
    assignment_version: ASSIGNMENT_VERSION,
    assignment_seed: ASSIGNMENT_SEED,
    allocation_id: trials[0].allocation_id,
    participant_slot: participantSlot,
    trial_count: trials.length,
    allocation_sha256: slotHash,
    trials
  };
  await fs.writeFile(path.join(slotsRoot, filename), JSON.stringify(payload, null, 2) + "\n");
  slotIndex.push({ participant_slot: participantSlot, allocation_id: payload.allocation_id, file: `slots/${filename}`, allocation_sha256: slotHash });
}
await fs.writeFile(path.join(outputRoot, "index.json"), JSON.stringify({
  schema_version: "text-enrichment-allocation-index-v2",
  study_version: STUDY_VERSION,
  assignment_version: ASSIGNMENT_VERSION,
  allocation_sha256: allocationHash,
  participant_slots: slotIndex
}, null, 2) + "\n");

await fs.writeFile(path.join(logRoot, "final-trial-log-template.csv"), TRIAL_LOG_HEADERS.join(",") + "\n");
await fs.writeFile(path.join(logRoot, "final-trial-log-template.json"), JSON.stringify({
  schema_version: TRIAL_LOG_SCHEMA_VERSION,
  study_version: STUDY_VERSION,
  columns: TRIAL_LOG_COLUMNS,
  records: []
}, null, 2) + "\n");

console.log(JSON.stringify({
  study_version: STUDY_VERSION,
  assignment_version: ASSIGNMENT_VERSION,
  participants: PARTICIPANTS,
  trials_per_participant: TRIALS_PER_PARTICIPANT,
  total_trials: records.length,
  allocation_sha256: allocationHash
}, null, 2));
