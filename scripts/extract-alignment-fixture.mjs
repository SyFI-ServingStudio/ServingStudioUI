#!/usr/bin/env node

/**
 * Build the checked-in alignment fixture from a live Analyzer service.
 *
 * The run fixture is assembled from analyzer output directories, but an
 * alignment bundle's protocol shape — the descriptor, the subject envelopes,
 * the byte ranges into the per-iteration shards — is synthesized by
 * `ui_service` at request time. Rebuilding that here would be a second
 * implementation of it, free to drift. So the fixture is extracted from the
 * service: whatever the app parses in production is what lands on disk.
 *
 * A real bundle is ~19 MB across eight documents plus a shard per iteration,
 * which is two orders of magnitude more than a fixture should carry. What is
 * dropped is recorded in `fixture.json` rather than left for a reader to
 * discover, because a fixture that quietly holds an empty array is how a
 * feature comes to look broken only in production.
 *
 * Usage:
 *   node scripts/extract-alignment-fixture.mjs \
 *     --service http://127.0.0.1:5311 --alignment al_<sha>
 *   node scripts/extract-alignment-fixture.mjs --check
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ID = "alignment-llama3-8b-tp4";
const FIXTURE_ALIGNMENT_ID = "al_fixture_llama3_8b_tp4";
const CATALOG_FILE = "alignment_catalog.json";
const ITERATION_COUNT = 3;
/** How many measured kernel rows the trimmed iteration report keeps. */
const KERNEL_ROWS = 40;
/** How many unmapped rows each side of the mapping board keeps. */
const UNMAPPED_ROWS = 12;
/** Points kept per whole-run series. Enough to keep the curve's shape; the
 * quantile markers beside it are the untouched exact ones. */
const CURVE_POINTS = 96;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vizUiRoot = resolve(scriptDirectory, "..");
const fixturesRoot = join(vizUiRoot, "fixtures", "analyzer-v1");
const fixtureRoot = join(fixturesRoot, FIXTURE_ID);

const DOCUMENTS = [
  {
    subject: "iteration",
    leaf: "report",
    file: "reports/alignment_iteration_report.json",
  },
  {
    subject: "iteration",
    leaf: "payload",
    file: "payloads/alignment_iteration_series.json",
  },
  {
    subject: "timeline",
    leaf: "payload",
    file: "payloads/alignment_timeline.json",
  },
  {
    subject: "workload",
    leaf: "report",
    file: "reports/alignment_workload_report.json",
  },
  {
    subject: "workload",
    leaf: "payload",
    file: "payloads/alignment_workload_series.json",
  },
  { subject: "e2e", leaf: "report", file: "reports/alignment_e2e_report.json" },
  {
    subject: "e2e",
    leaf: "payload",
    file: "payloads/alignment_e2e_series.json",
  },
];

function parseArguments(argv) {
  const options = {
    check: false,
    service: "http://127.0.0.1:5311",
    alignment: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--service") options.service = argv[(index += 1)];
    else if (argument === "--alignment") options.alignment = argv[(index += 1)];
    else if (argument === "--help" || argument === "-h") {
      console.log(
        [
          "Usage: extract-alignment-fixture.mjs [--service URL --alignment ID] [--check]",
          "",
          "  --service URL   Analyzer service serving the source bundle",
          "  --alignment ID  Opaque alignment id to extract",
          "  --check         Verify the checked-in fixture is self-consistent",
        ].join("\n"),
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function fetchJson(url) {
  // Large alignment shards can trigger undici's compressed-body backpressure
  // assertion. A fixture extractor values deterministic bytes over transfer
  // size, so ask the local Analyzer for the identity representation.
  const response = await fetch(url, {
    headers: { "Accept-Encoding": "identity" },
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObjectKeys(value[key])]),
  );
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`,
    "utf8",
  );
}

/** First, middle and last, so the fixture spans the capture's regimes — and so
 * it carries the last iteration, whose GPU cycle is null because no next
 * boundary closes it. That row is the one every consumer must survive. */
function spreadSelection(ids, count) {
  if (ids.length <= count) return [...ids];
  return [
    ids[0],
    ids[Math.floor((ids.length - 1) / 2)],
    ids[ids.length - 1],
  ].slice(0, count);
}

function keepIterations(rows, keptIds) {
  return rows.filter((row) => keptIds.includes(row.iteration_id));
}

function keepByteRanges(detail, keptIds) {
  if (detail === null || detail === undefined) return detail;
  const byteRanges = {};
  for (const id of keptIds) {
    const range = detail.byte_ranges[String(id)];
    if (range !== undefined) byteRanges[String(id)] = range;
  }
  return { ...detail, byte_ranges: byteRanges };
}

function topBy(rows, key, limit) {
  return [...rows]
    .sort((left, right) => right[key] - left[key])
    .slice(0, limit);
}

function trimIterationReport(report, keptIds, trims) {
  const kernels = topBy(report.kernels, "total_ms", KERNEL_ROWS);
  trims.push(
    `iteration report: kernels ${report.kernels.length} -> ${kernels.length}, costliest first`,
  );
  const mapping = {
    ...report.mapping,
    unmapped_measured_kernels: topBy(
      report.mapping.unmapped_measured_kernels,
      "total_ms",
      UNMAPPED_ROWS,
    ),
    unmapped_simulated_slots: topBy(
      report.mapping.unmapped_simulated_slots,
      "total_ms",
      UNMAPPED_ROWS,
    ),
  };
  trims.push(
    `iteration report: unmapped rows capped at ${UNMAPPED_ROWS} per side; coverage numbers are the untrimmed ones`,
  );
  return {
    ...report,
    iterations: keepIterations(report.iterations, keptIds),
    kernels,
    mapping,
  };
}

function trimIterationSeries(series, keptIds, trims) {
  const sequences =
    series.sequences === null ? null : trimSequences(series.sequences, keptIds);
  if (sequences !== null)
    trims.push(
      "iteration series: sequences kept only for the fixture iterations",
    );
  return {
    ...series,
    iterations: keepIterations(series.iterations, keptIds),
    sequences,
    breakdown_detail: keepByteRanges(series.breakdown_detail, keptIds),
  };
}

function trimSequences(sequences, keptIds) {
  const phases = {};
  for (const [phase, block] of Object.entries(sequences.phases)) {
    const unique = block.unique_sequences.filter((sequence) =>
      sequence.iterations.some((id) => keptIds.includes(id)),
    );
    if (unique.length > 0)
      phases[phase] = { ...block, unique_sequences: unique };
  }
  return { ...sequences, phases };
}

function trimTimelineIndex(index, keptIds) {
  return {
    ...index,
    iterations: keepIterations(index.iterations, keptIds),
    iteration_detail: keepByteRanges(index.iteration_detail, keptIds),
  };
}

/** Only the reference rank's intervals are drawn or folded; the other ranks'
 * copies are the bulk of a shard and nothing reads them. */
function trimTimelineIteration(iteration, referenceDeviceId, trims) {
  const kernels = iteration.measured.kernels.map((kernel) => ({
    ...kernel,
    iv: kernel.iv.filter(([deviceId]) => deviceId === referenceDeviceId),
  }));
  trims.push(
    `timeline iteration ${iteration.iteration_id}: kernel intervals kept for reference rank ${referenceDeviceId} only`,
  );
  return { ...iteration, measured: { ...iteration.measured, kernels } };
}

function evenlySpacedIndices(length, target) {
  if (length <= target) return [...Array(length).keys()];
  return [...Array(target).keys()].map((step) =>
    Math.round((step * (length - 1)) / (target - 1)),
  );
}

function downsampleParallelArrays(block, trims, label) {
  const lengths = Object.values(block)
    .filter(Array.isArray)
    .map((values) => values.length);
  const length = lengths[0] ?? 0;
  if (length <= CURVE_POINTS || lengths.some((other) => other !== length))
    return block;
  const indices = evenlySpacedIndices(length, CURVE_POINTS);
  trims.push(`${label}: ${length} -> ${indices.length} points per series`);
  return Object.fromEntries(
    Object.entries(block).map(([key, value]) => [
      key,
      Array.isArray(value) ? indices.map((index) => value[index]) : value,
    ]),
  );
}

function trimWorkloadSeries(series, trims) {
  return {
    ...series,
    measured: downsampleParallelArrays(
      series.measured,
      trims,
      "workload series measured",
    ),
    simulated: downsampleParallelArrays(
      series.simulated,
      trims,
      "workload series simulated",
    ),
  };
}

function trimE2eSeries(series, trims) {
  return {
    ...series,
    latency_cdf_comparisons: series.latency_cdf_comparisons.map(
      (comparison) => ({
        ...comparison,
        measured: downsampleParallelArrays(
          comparison.measured,
          trims,
          `cdf ${comparison.key} measured`,
        ),
        simulated: downsampleParallelArrays(
          comparison.simulated,
          trims,
          `cdf ${comparison.key} simulated`,
        ),
      }),
    ),
  };
}

/**
 * Keep only the host strings the kept iterations name, and renumber the shards
 * to match.
 *
 * The pool is capture-wide — every NVTX mark and CUDA API name the run ever
 * emitted — and three iterations reach a few dozen of them. It is by far the
 * largest thing in the index, and dropping it wholesale would leave every host
 * bar unlabelled.
 */
function pruneHostStrings(timelineIndex, shards, trims) {
  const host = timelineIndex.meta.host_timeline;
  if (host === null || host === undefined) return { timelineIndex, shards };
  const used = new Set();
  for (const shard of shards.values()) {
    for (const lane of [shard.host?.nvtx, shard.host?.api]) {
      for (const events of Object.values(lane ?? {})) {
        for (const [, , stringId] of events) used.add(stringId);
      }
    }
  }
  const keptIds = [...used].sort((left, right) => left - right);
  const remapped = new Map(keptIds.map((stringId, index) => [stringId, index]));
  trims.push(
    `host string pool ${host.strings.length} -> ${keptIds.length}, renumbered`,
  );

  const renumber = (lane) =>
    Object.fromEntries(
      Object.entries(lane ?? {}).map(([threadIndex, events]) => [
        threadIndex,
        events.map(([start, duration, stringId, classifier]) => [
          start,
          duration,
          remapped.get(stringId) ?? 0,
          classifier,
        ]),
      ]),
    );

  return {
    timelineIndex: {
      ...timelineIndex,
      meta: {
        ...timelineIndex.meta,
        host_timeline: {
          ...host,
          strings: keptIds.map((stringId) => host.strings[stringId]),
        },
      },
    },
    shards: new Map(
      [...shards].map(([file, shard]) => [
        file,
        shard.host === null || shard.host === undefined
          ? shard
          : {
              ...shard,
              host: {
                ...shard.host,
                nvtx: renumber(shard.host.nvtx),
                api: renumber(shard.host.api),
              },
            },
      ]),
    ),
  };
}

function trimDocument(file, body, keptIds, trims) {
  if (file.endsWith("alignment_iteration_report.json")) {
    return trimIterationReport(body, keptIds, trims);
  }
  if (file.endsWith("alignment_workload_series.json"))
    return trimWorkloadSeries(body, trims);
  if (file.endsWith("alignment_e2e_series.json"))
    return trimE2eSeries(body, trims);
  return body;
}

function retargetIds(value, sourceAlignmentId) {
  const text = JSON.stringify(value)
    .split(sourceAlignmentId)
    .join(FIXTURE_ALIGNMENT_ID);
  return JSON.parse(text);
}

async function extract(options) {
  if (options.alignment === null)
    throw new Error("--alignment is required without --check");
  const base = `${options.service.replace(/\/$/, "")}/api/v1/alignments/${options.alignment}`;
  const subject = (name, leaf) => `${base}/subjects/${name}/${leaf}`;

  const descriptor = await fetchJson(`${base}/descriptor`);
  const timelineIndex = await fetchJson(subject("timeline", "payload"));
  const iterationSeries = await fetchJson(subject("iteration", "payload"));

  const shardedIds = Object.keys(
    timelineIndex.iteration_detail?.byte_ranges ?? {},
  )
    .map(Number)
    .filter(
      (id) =>
        iterationSeries.breakdown_detail?.byte_ranges?.[String(id)] !==
        undefined,
    )
    .sort((left, right) => left - right);
  const keptIds = spreadSelection(shardedIds, ITERATION_COUNT);
  if (keptIds.length === 0)
    throw new Error("Source bundle serves no per-iteration detail.");

  const trims = [
    `iterations ${shardedIds.length} -> ${keptIds.length}: ${keptIds.join(", ")}`,
  ];
  const referenceDeviceId = timelineIndex.meta.reference_device_id;

  // Shards first: what they reference is what the index's string pool has to
  // keep, so the pool cannot be pruned before they are in hand.
  let shards = new Map();
  const breakdowns = new Map();
  for (const iterationId of keptIds) {
    shards.set(
      `iterations/timeline_${iterationId}.json`,
      trimTimelineIteration(
        await fetchJson(`${base}/subjects/timeline/iterations/${iterationId}`),
        referenceDeviceId,
        trims,
      ),
    );
    breakdowns.set(
      `iterations/breakdown_${iterationId}.json`,
      await fetchJson(`${base}/subjects/iteration/iterations/${iterationId}`),
    );
  }
  const pruned = pruneHostStrings(timelineIndex, shards, trims);
  shards = pruned.shards;

  const documents = new Map([...shards, ...breakdowns]);
  documents.set(
    "payloads/alignment_timeline.json",
    trimTimelineIndex(pruned.timelineIndex, keptIds),
  );
  documents.set(
    "payloads/alignment_iteration_series.json",
    trimIterationSeries(iterationSeries, keptIds, trims),
  );
  for (const document of DOCUMENTS) {
    if (documents.has(document.file)) continue;
    const body = await fetchJson(subject(document.subject, document.leaf));
    documents.set(
      document.file,
      trimDocument(document.file, body, keptIds, trims),
    );
  }

  await writeJson(
    join(fixtureRoot, "alignment_descriptor.json"),
    retargetIds(descriptor, options.alignment),
  );
  for (const [file, body] of documents) {
    await writeJson(
      join(fixtureRoot, file),
      retargetIds(body, options.alignment),
    );
  }
  await writeJson(join(fixtureRoot, "fixture.json"), {
    fixture_id: FIXTURE_ID,
    alignment_id: FIXTURE_ALIGNMENT_ID,
    source_alignment_id: options.alignment,
    source_display_name: descriptor.display_name,
    iteration_ids: keptIds,
    trims,
  });
  await writeJson(join(fixturesRoot, CATALOG_FILE), {
    protocol_version: 1,
    alignments: [
      {
        alignment_id: FIXTURE_ALIGNMENT_ID,
        display_name: descriptor.display_name,
        kind: "alignment",
        descriptor_href: `${FIXTURE_ID}/alignment_descriptor.json`,
        lifecycle: descriptor.lifecycle,
        workspace_id: "w_main",
      },
    ],
  });

  console.log(
    `wrote ${documents.size + 3} files under fixtures/analyzer-v1/${FIXTURE_ID}`,
  );
  for (const note of trims) console.log(`  trim: ${note}`);
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(join(fixtureRoot, relativePath), "utf8"));
}

async function check() {
  const failures = [];
  const catalog = JSON.parse(
    await readFile(join(fixturesRoot, CATALOG_FILE), "utf8"),
  );
  const entry = catalog.alignments.find(
    (row) => row.alignment_id === FIXTURE_ALIGNMENT_ID,
  );
  if (entry === undefined)
    failures.push(`${CATALOG_FILE} does not list ${FIXTURE_ALIGNMENT_ID}`);

  const descriptor = await readFixture("alignment_descriptor.json");
  if (descriptor.alignment_id !== FIXTURE_ALIGNMENT_ID) {
    failures.push("descriptor alignment id does not match the catalog");
  }

  const metadata = await readFixture("fixture.json");
  const timelineIndex = await readFixture("payloads/alignment_timeline.json");
  const iterationSeries = await readFixture(
    "payloads/alignment_iteration_series.json",
  );
  const indexedIds = timelineIndex.iterations.map((row) => row.iteration_id);
  if (JSON.stringify(indexedIds) !== JSON.stringify(metadata.iteration_ids)) {
    failures.push(
      `timeline index lists ${indexedIds} but fixture.json declares ${metadata.iteration_ids}`,
    );
  }
  for (const iterationId of metadata.iteration_ids) {
    for (const shard of [
      `timeline_${iterationId}`,
      `breakdown_${iterationId}`,
    ]) {
      const record = await readFixture(`iterations/${shard}.json`).catch(
        () => null,
      );
      if (record === null)
        failures.push(`missing shard iterations/${shard}.json`);
      else if (record.iteration_id !== iterationId) {
        failures.push(
          `shard ${shard} carries iteration ${record.iteration_id}`,
        );
      } else if (
        shard.startsWith("breakdown_") &&
        (record.measured_kernels.length === 0 ||
          record.simulated_kernels.length === 0)
      ) {
        failures.push(
          `shard ${shard} does not exercise its per-call measured/modelled rows`,
        );
      }
    }
    if (
      timelineIndex.iteration_detail.byte_ranges[String(iterationId)] ===
      undefined
    ) {
      failures.push(`timeline index has no byte range for ${iterationId}`);
    }
    if (
      iterationSeries.breakdown_detail.byte_ranges[String(iterationId)] ===
      undefined
    ) {
      failures.push(`iteration series has no byte range for ${iterationId}`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log(
    `alignment fixture ${FIXTURE_ID} is self-consistent (${metadata.iteration_ids.length} iterations)`,
  );
}

const options = parseArguments(process.argv.slice(2));
if (options.check) await check();
else await extract(options);
