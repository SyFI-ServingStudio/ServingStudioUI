#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ID = "afd-qwen3-duration-reached";
const DEFAULT_RUN_ID = "fixture-afd-qwen3-v1";
const DEFAULT_SOURCE_RUN = "main/logs/20260715_1_afd_ui_reanalysis";
const SLO_TARGET_POINTS = 64;
const BATCH_TARGET_POINTS = 128;
const DESCRIPTOR_FILE = "run_descriptor.json";
const CATALOG_FILE = "run_catalog.json";
const PROTOCOL_FILES = [`../${CATALOG_FILE}`, DESCRIPTOR_FILE];

const poolRoles = {
  unified: ["main"],
  pd: ["prefill", "decode"],
  afd: ["attn", "ffn"],
};

const subjectArtifacts = [
  [
    "slo-general",
    "reports/slo_general_report.json",
    "payloads/slo_general_cdf.json",
  ],
  [
    "slo-detailed",
    "reports/slo_detailed_report.json",
    "payloads/slo_detailed_cdf.json",
  ],
  [
    "throughput",
    "reports/throughput_report.json",
    "payloads/throughput_segments.json",
  ],
  [
    "utilization",
    "reports/utilization_report.json",
    "payloads/utilization_series.json",
  ],
  ["batch", "reports/batch_report.json", "payloads/batch_scatter.json"],
  [
    "kernel-throughput",
    "reports/kernel_throughput_report.json",
    "payloads/kernel_throughput_locations.json",
  ],
  [
    "kernel-input-distribution",
    "reports/kernel_input_distribution_report.json",
    "payloads/kernel_input_distribution_scatter.json",
  ],
  [
    "kernel-time-share",
    "reports/kernel_time_share_report.json",
    "payloads/kernel_time_share_composition.json",
  ],
  [
    "workload-conservation",
    "reports/workload_conservation_report.json",
    "payloads/workload_conservation_checks.json",
  ],
  [
    "kv-occupancy",
    "reports/kv_occupancy_report.json",
    "payloads/kv_occupancy_series.json",
  ],
];

const unavailableCodes = {
  "slo-detailed": "output_token_times_missing",
  "kernel-input-distribution": "missing_kernel_input_columns",
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const vizUiRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(vizUiRoot, "..");

// Keep an explicit bounded allowlist: fixture generation must never discover or
// read Parquet/raw fact tables merely because a new analyzer artifact appears.
const sourceFiles = [
  "payloads/batch_scatter.json",
  "payloads/kernel_input_distribution_scatter.json",
  "payloads/kernel_throughput_locations.json",
  "payloads/kernel_time_share_composition.json",
  "payloads/kv_occupancy_series.json",
  "payloads/slo_detailed_cdf.json",
  "payloads/slo_general_cdf.json",
  "payloads/throughput_segments.json",
  "payloads/utilization_series.json",
  "payloads/workload_conservation_checks.json",
  "raw/params.json",
  "raw/run_meta.json",
  "reanalysis_source.json",
  "reports/analyzer_timing.json",
  "reports/batch_report.json",
  "reports/kernel_input_distribution_report.json",
  "reports/kernel_throughput_report.json",
  "reports/kernel_time_share_report.json",
  "reports/kv_occupancy_report.json",
  "reports/slo_detailed_report.json",
  "reports/slo_general_report.json",
  "reports/throughput_report.json",
  "reports/utilization_report.json",
  "reports/workload_conservation_report.json",
  "summary.json",
];

function parseArguments(argv) {
  const options = {
    check: false,
    source: resolve(workspaceRoot, DEFAULT_SOURCE_RUN),
    output: resolve(vizUiRoot, "fixtures/analyzer-v1", FIXTURE_ID),
    runId: DEFAULT_RUN_ID,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (
      argument === "--source" ||
      argument === "--output" ||
      argument === "--run-id"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      if (argument === "--run-id") {
        options.runId = value;
      } else {
        options[argument.slice(2)] = resolve(process.cwd(), value);
      }
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/extract-analyzer-fixture.mjs [options]",
          "",
          "Options:",
          "  --check         Verify checked-in fixture protocol files without writing",
          `  --source <dir>  Analyzer run directory (default: ../${DEFAULT_SOURCE_RUN})`,
          `  --output <dir>  Fixture directory (default: fixtures/analyzer-v1/${FIXTURE_ID})`,
          `  --run-id <id>   Stable opaque catalog id (default: ${DEFAULT_RUN_ID})`,
          "  -h, --help      Show this help",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function toPortableWorkspacePath(absolutePath) {
  const workspaceRelativePath = relative(workspaceRoot, absolutePath);
  if (
    workspaceRelativePath === "" ||
    workspaceRelativePath === ".." ||
    workspaceRelativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(
      `Source must be inside the MLSim workspace so metadata does not contain an absolute machine path: ${absolutePath}`,
    );
  }
  return workspaceRelativePath.split(sep).join("/");
}

function evenlySpacedIndices(length, targetLength) {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`Cannot sample invalid array length: ${length}`);
  }
  if (!Number.isInteger(targetLength) || targetLength < 2) {
    throw new Error(
      `Target length must be an integer of at least 2: ${targetLength}`,
    );
  }
  if (length <= targetLength) {
    return Array.from({ length }, (_, index) => index);
  }

  // One shared index vector is applied to every correlated axis/series so a
  // fixture preserves real point alignment as well as both endpoints.
  return Array.from({ length: targetLength }, (_, index) =>
    Math.round((index * (length - 1)) / (targetLength - 1)),
  );
}

function selectIndices(values, indices) {
  return indices.map((index) => values[index]);
}

function trimSloGeneral(payload, relativePath) {
  if (!Array.isArray(payload.series)) {
    throw new Error(`${relativePath}: expected series to be an array`);
  }

  return {
    ...payload,
    series: payload.series.map((series, seriesIndex) => {
      if (!Array.isArray(series.x) || !Array.isArray(series.y_pct)) {
        throw new Error(
          `${relativePath}: series[${seriesIndex}] must contain x and y_pct arrays`,
        );
      }
      if (series.x.length !== series.y_pct.length) {
        throw new Error(
          `${relativePath}: series[${seriesIndex}] x/y_pct length mismatch (${series.x.length} vs ${series.y_pct.length})`,
        );
      }

      const selectedIndices = evenlySpacedIndices(
        series.x.length,
        SLO_TARGET_POINTS,
      );
      return {
        ...series,
        x: selectIndices(series.x, selectedIndices),
        y_pct: selectIndices(series.y_pct, selectedIndices),
      };
    }),
  };
}

function trimBatchScatter(payload, relativePath) {
  if (!Array.isArray(payload.pools)) {
    throw new Error(`${relativePath}: expected pools to be an array`);
  }

  return {
    ...payload,
    pools: payload.pools.map((pool, poolIndex) => {
      if (!Array.isArray(pool.time_ms) || !Array.isArray(pool.series)) {
        throw new Error(
          `${relativePath}: pools[${poolIndex}] must contain time_ms and series arrays`,
        );
      }

      const selectedIndices = evenlySpacedIndices(
        pool.time_ms.length,
        BATCH_TARGET_POINTS,
      );
      const sampledSeries = pool.series.map((series, seriesIndex) => {
        if (!Array.isArray(series.values)) {
          throw new Error(
            `${relativePath}: pools[${poolIndex}].series[${seriesIndex}].values must be an array`,
          );
        }
        if (series.values.length !== pool.time_ms.length) {
          throw new Error(
            `${relativePath}: pools[${poolIndex}].series[${seriesIndex}] has ${series.values.length} values for ${pool.time_ms.length} timestamps`,
          );
        }
        return {
          ...series,
          values: selectIndices(series.values, selectedIndices),
        };
      });

      return {
        ...pool,
        plotted_points: selectedIndices.length,
        series: sampledSeries,
        time_ms: selectIndices(pool.time_ms, selectedIndices),
      };
    }),
  };
}

function transformArtifact(relativePath, parsedJson) {
  if (relativePath === "payloads/slo_general_cdf.json") {
    return trimSloGeneral(parsedJson, relativePath);
  }
  if (relativePath === "payloads/batch_scatter.json") {
    return trimBatchScatter(parsedJson, relativePath);
  }
  return parsedJson;
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObjectKeys(value[key])]),
    );
  }
  return value;
}

function serializeJson(value) {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: expected an object`);
  }
  return value;
}

function requireNonBlankString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}: expected a non-blank string`);
  }
  return value;
}

function artifactDigest(artifacts) {
  const hash = createHash("sha256");
  for (const relativePath of [...sourceFiles].sort()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(serializeJson(artifacts.get(relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function subjectEnvelope(subjectId, reportPath, payloadPath, payload) {
  const meta = requireObject(payload.meta, `${payloadPath}.meta`);
  if (meta.available === false) {
    return {
      status: "unavailable",
      code: unavailableCodes[subjectId] ?? "analyzer_subject_unavailable",
      reason: requireNonBlankString(meta.reason, `${payloadPath}.meta.reason`),
    };
  }
  if (payload.schema_version !== 1) {
    throw new Error(`${payloadPath}.schema_version: expected analyzer v1`);
  }
  return {
    status: "ready",
    schema_version: 1,
    report_href: reportPath,
    payload_href: payloadPath,
  };
}

function buildSubjects(artifacts) {
  const subjects = Object.fromEntries(
    subjectArtifacts.map(([subjectId, reportPath, payloadPath]) => [
      subjectId,
      subjectEnvelope(
        subjectId,
        reportPath,
        payloadPath,
        artifacts.get(payloadPath),
      ),
    ]),
  );
  subjects.concurrency = {
    status: "not_generated",
    reason:
      "No bounded concurrency timeline artifact was generated for this run.",
  };
  subjects.backpressure = {
    status: "not_generated",
    reason: "Pending-queue logging is not yet available from analyzer v1.",
  };
  return subjects;
}

function analyzerLogDir(artifacts) {
  const logDirs = new Set();
  for (const [, , payloadPath] of subjectArtifacts) {
    const payload = requireObject(artifacts.get(payloadPath), payloadPath);
    const meta = requireObject(payload.meta, `${payloadPath}.meta`);
    logDirs.add(
      requireNonBlankString(meta.log_dir, `${payloadPath}.meta.log_dir`),
    );
  }
  if (logDirs.size !== 1) {
    throw new Error(
      `Analyzer payloads disagree on meta.log_dir: ${[...logDirs].join(", ")}`,
    );
  }
  return [...logDirs][0];
}

function modelNameFromParams(params) {
  const models = new Set();
  for (const pool of Object.values(
    requireObject(params.pools, "raw/params.json.pools"),
  )) {
    const groups = requireObject(pool, "raw/params.json pool").groups;
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error(
        "raw/params.json: every pool must contain at least one group",
      );
    }
    for (const group of groups) {
      const arch = requireObject(
        requireObject(group, "raw/params.json group").arch,
        "raw/params.json group.arch",
      );
      models.add(
        requireNonBlankString(
          arch.model_config,
          "raw/params.json arch.model_config",
        ),
      );
    }
  }
  if (models.size !== 1) {
    throw new Error(`raw/params.json contains ${models.size} model identities`);
  }
  return [...models][0];
}

function descriptorWorkers(params, runMeta) {
  const roles = poolRoles[params.deployment];
  if (roles === undefined) {
    throw new Error(
      `raw/params.json.deployment: unsupported value ${params.deployment}`,
    );
  }
  if (!Array.isArray(runMeta.workers) || runMeta.workers.length === 0) {
    throw new Error("raw/run_meta.json.workers: expected a non-empty array");
  }
  const workers = runMeta.workers.map((worker, index) => {
    const poolTag = roles[worker.pool];
    if (poolTag === undefined) {
      throw new Error(
        `raw/run_meta.json.workers[${index}].pool: unknown numeric pool`,
      );
    }
    if (
      worker.pool_tag !== null &&
      worker.pool_tag !== undefined &&
      worker.pool_tag !== poolTag
    ) {
      throw new Error(
        `raw/run_meta.json.workers[${index}].pool_tag disagrees with deployment role ${poolTag}`,
      );
    }
    if (!Number.isSafeInteger(worker.worker_id) || worker.worker_id < 0) {
      throw new Error(
        `raw/run_meta.json.workers[${index}].worker_id: expected a safe integer`,
      );
    }
    return { pool_tag: poolTag, worker_id: worker.worker_id };
  });
  const keys = workers.map(
    (worker) => `${worker.pool_tag}/${worker.worker_id}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "raw/run_meta.json.workers: duplicate composite worker identity",
    );
  }
  return workers;
}

function buildRunDescriptor({ artifacts, fixtureId, generatedAt, runId }) {
  const params = requireObject(
    artifacts.get("raw/params.json"),
    "raw/params.json",
  );
  const runMeta = requireObject(
    artifacts.get("raw/run_meta.json"),
    "raw/run_meta.json",
  );
  return {
    protocol_version: 1,
    // Checked-in fixtures belong to the canonical development workspace. Live
    // catalogs obtain this same field from the workspace registry.
    workspace_id: "w_main",
    run_id: requireNonBlankString(runId, "--run-id"),
    kind: "simulation",
    display_name: basename(analyzerLogDir(artifacts)),
    model_name: modelNameFromParams(params),
    deployment: params.deployment,
    lifecycle: { simulation: "complete", analysis: "complete" },
    summary: { href: "summary.json" },
    workers: descriptorWorkers(params, runMeta),
    subjects: buildSubjects(artifacts),
    details: {
      "worker-cost-tree": {
        status: "not_generated",
        reason: "No versioned hierarchical worker CostTree query is available.",
      },
      "worker-iteration-index": {
        status: "not_generated",
        reason:
          "No paginated worker iteration index was generated for this run.",
      },
      "iteration-detail": {
        status: "not_generated",
        reason:
          "No on-demand iteration detail artifact was generated for this run.",
      },
    },
    traces: {
      perfetto: {
        status: "not_generated",
        reason:
          "The cropped fixture does not contain the source run's Perfetto trace.",
      },
    },
    analysis: {
      revision: `fixture-sha256-${artifactDigest(artifacts)}`,
      generated_at: generatedAt,
      generator_version: "fixture-export-v1+analyzer-v1",
    },
    provenance: {
      source: "fixture",
      synthetic: false,
      fixture_id: fixtureId,
      source_run: analyzerLogDir(artifacts),
      generated_at: generatedAt,
    },
  };
}

async function readSourceArtifacts(sourceRoot) {
  const missingFiles = [];
  const artifacts = new Map();

  for (const relativePath of sourceFiles) {
    const sourcePath = resolve(sourceRoot, relativePath);
    let contents;
    try {
      contents = await readFile(sourcePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        missingFiles.push(relativePath);
        continue;
      }
      throw new Error(`Failed to read ${relativePath}: ${error.message}`, {
        cause: error,
      });
    }

    try {
      artifacts.set(
        relativePath,
        transformArtifact(relativePath, JSON.parse(contents)),
      );
    } catch (error) {
      throw new Error(`Failed to process ${relativePath}: ${error.message}`, {
        cause: error,
      });
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(
      `Analyzer source is missing ${missingFiles.length} required JSON file(s):\n${missingFiles
        .map((relativePath) => `  - ${relativePath}`)
        .join("\n")}`,
    );
  }

  return artifacts;
}

function buildFixtureMetadata(sourceRun, fixtureId) {
  return {
    fixture_id: fixtureId,
    fixture_schema_version: 1,
    known_issues: [
      {
        code: "slo-detailed-unavailable",
        detail:
          "Detailed SLO is unavailable because output_token_times were not logged for this run.",
      },
      {
        code: "kernel-input-distribution-unavailable",
        detail:
          "Kernel input distribution is unavailable because the original simulation predates slot_backend and slot_input logging.",
      },
    ],
    protocol_files: PROTOCOL_FILES,
    verified_invariants: {
      utilization_worker_count: 10,
      utilization_workers_by_pool: { attn: 8, ffn: 2 },
      utilization_series_unclamped: true,
    },
    source_files: sourceFiles,
    source_run: sourceRun,
    synthetic: false,
    transforms: [
      {
        algorithm: "round(i * (length - 1) / (target - 1))",
        path: "payloads/slo_general_cdf.json",
        preserve_endpoints: true,
        synchronized_fields: ["series[].x", "series[].y_pct"],
        target_points_per_series: SLO_TARGET_POINTS,
      },
      {
        algorithm: "round(i * (length - 1) / (target - 1))",
        path: "payloads/batch_scatter.json",
        preserve_endpoints: true,
        synchronized_fields: ["pools[].time_ms", "pools[].series[].values"],
        target_points_per_pool: BATCH_TARGET_POINTS,
        updated_fields: ["pools[].plotted_points"],
      },
    ],
  };
}

async function writeFixture(outputRoot, artifacts, metadata, descriptor) {
  for (const relativePath of sourceFiles) {
    const destinationPath = resolve(outputRoot, relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(
      destinationPath,
      serializeJson(artifacts.get(relativePath)),
      "utf8",
    );
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    resolve(outputRoot, "fixture.json"),
    serializeJson(metadata),
    "utf8",
  );
  await writeFile(
    resolve(outputRoot, DESCRIPTOR_FILE),
    serializeJson(descriptor),
    "utf8",
  );
}

function catalogEntry(directoryName, descriptor) {
  const analysis = requireObject(
    descriptor.analysis,
    `${directoryName}/${DESCRIPTOR_FILE}.analysis`,
  );
  return {
    workspace_id: requireNonBlankString(
      descriptor.workspace_id,
      `${directoryName} workspace_id`,
    ),
    run_id: requireNonBlankString(descriptor.run_id, `${directoryName} run_id`),
    kind: "simulation",
    display_name: requireNonBlankString(
      descriptor.display_name,
      `${directoryName} display_name`,
    ),
    descriptor_href: `${directoryName}/${DESCRIPTOR_FILE}`,
    lifecycle: requireObject(
      descriptor.lifecycle,
      `${directoryName} lifecycle`,
    ),
    updated_at: requireNonBlankString(
      analysis.generated_at,
      `${directoryName} generated_at`,
    ),
  };
}

async function buildFixtureCatalog(fixturesRoot) {
  const directories = (await readdir(fixturesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const runs = [];
  for (const directoryName of directories) {
    const descriptorPath = resolve(
      fixturesRoot,
      directoryName,
      DESCRIPTOR_FILE,
    );
    let contents;
    try {
      contents = await readFile(descriptorPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`Failed to read ${descriptorPath}: ${error.message}`, {
        cause: error,
      });
    }
    const descriptor = JSON.parse(contents);
    if (descriptor.protocol_version !== 1 || descriptor.kind !== "simulation") {
      throw new Error(
        `${descriptorPath}: expected a simulation descriptor using protocol v1`,
      );
    }
    runs.push(catalogEntry(directoryName, descriptor));
  }
  const runIds = runs.map((run) => run.run_id);
  if (new Set(runIds).size !== runIds.length) {
    throw new Error("Fixture descriptors contain duplicate opaque run ids");
  }
  runs.sort(
    (left, right) =>
      right.updated_at.localeCompare(left.updated_at) ||
      left.run_id.localeCompare(right.run_id),
  );
  const generatedAt = runs[0]?.updated_at;
  if (generatedAt === undefined) {
    throw new Error(`No ${DESCRIPTOR_FILE} files found below ${fixturesRoot}`);
  }
  return { protocol_version: 1, generated_at: generatedAt, runs };
}

async function readJsonFile(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`, {
      cause: error,
    });
  }
}

async function verifyJsonFile(path, expected, label) {
  const actual = await readFile(path, "utf8");
  const expectedContents = serializeJson(expected);
  if (actual !== expectedContents) {
    throw new Error(`${label} is stale; regenerate it with this script`);
  }
}

async function verifyFixture(outputRoot, runId) {
  const artifacts = await readSourceArtifacts(outputRoot);
  const fixtureId = basename(outputRoot);
  const existingMetadata = await readJsonFile(
    resolve(outputRoot, "fixture.json"),
    "fixture.json",
  );
  const sourceRun = requireNonBlankString(
    existingMetadata.source_run,
    "fixture.json.source_run",
  );
  const reanalysisSource = requireObject(
    artifacts.get("reanalysis_source.json"),
    "reanalysis_source.json",
  );
  const generatedAt = requireNonBlankString(
    reanalysisSource.copied_at_utc,
    "reanalysis_source.json.copied_at_utc",
  );
  await verifyJsonFile(
    resolve(outputRoot, "fixture.json"),
    buildFixtureMetadata(sourceRun, fixtureId),
    "fixture.json",
  );
  await verifyJsonFile(
    resolve(outputRoot, DESCRIPTOR_FILE),
    buildRunDescriptor({ artifacts, fixtureId, generatedAt, runId }),
    DESCRIPTOR_FILE,
  );
  const fixturesRoot = dirname(outputRoot);
  await verifyJsonFile(
    resolve(fixturesRoot, CATALOG_FILE),
    await buildFixtureCatalog(fixturesRoot),
    CATALOG_FILE,
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.check) {
    await verifyFixture(options.output, options.runId);
    process.stdout.write(
      `Verified analyzer fixture protocol at ${options.output}\n`,
    );
    return;
  }
  const sourceRun = toPortableWorkspacePath(options.source);
  const artifacts = await readSourceArtifacts(options.source);
  const fixtureId = basename(options.output);
  const reanalysisSource = requireObject(
    artifacts.get("reanalysis_source.json"),
    "reanalysis_source.json",
  );
  const generatedAt = requireNonBlankString(
    reanalysisSource.copied_at_utc,
    "reanalysis_source.json.copied_at_utc",
  );
  const metadata = buildFixtureMetadata(sourceRun, fixtureId);
  const descriptor = buildRunDescriptor({
    artifacts,
    fixtureId,
    generatedAt,
    runId: options.runId,
  });
  await writeFixture(options.output, artifacts, metadata, descriptor);

  const fixturesRoot = dirname(options.output);
  const catalog = await buildFixtureCatalog(fixturesRoot);
  await writeFile(
    resolve(fixturesRoot, CATALOG_FILE),
    serializeJson(catalog),
    "utf8",
  );

  process.stdout.write(
    `Extracted ${artifacts.size} analyzer artifacts plus protocol sidecars to ${relative(process.cwd(), options.output) || "."}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Fixture extraction failed: ${error.message}\n`);
  process.exitCode = 1;
});
