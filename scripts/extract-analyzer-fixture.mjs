#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ID = "afd-qwen3-duration-reached";
const DEFAULT_SOURCE_RUN = "main/logs/20260715_1_afd_ui_reanalysis";
const SLO_TARGET_POINTS = 64;
const BATCH_TARGET_POINTS = 128;

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
    source: resolve(workspaceRoot, DEFAULT_SOURCE_RUN),
    output: resolve(vizUiRoot, "fixtures/analyzer-v1", FIXTURE_ID),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source" || argument === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      options[argument.slice(2)] = resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/extract-analyzer-fixture.mjs [options]",
          "",
          "Options:",
          `  --source <dir>  Analyzer run directory (default: ../${DEFAULT_SOURCE_RUN})`,
          `  --output <dir>  Fixture directory (default: fixtures/analyzer-v1/${FIXTURE_ID})`,
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
    throw new Error(`Target length must be an integer of at least 2: ${targetLength}`);
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
        throw new Error(`${relativePath}: series[${seriesIndex}] must contain x and y_pct arrays`);
      }
      if (series.x.length !== series.y_pct.length) {
        throw new Error(
          `${relativePath}: series[${seriesIndex}] x/y_pct length mismatch (${series.x.length} vs ${series.y_pct.length})`,
        );
      }

      const selectedIndices = evenlySpacedIndices(series.x.length, SLO_TARGET_POINTS);
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
        throw new Error(`${relativePath}: pools[${poolIndex}] must contain time_ms and series arrays`);
      }

      const selectedIndices = evenlySpacedIndices(pool.time_ms.length, BATCH_TARGET_POINTS);
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
      throw new Error(`Failed to read ${relativePath}: ${error.message}`, { cause: error });
    }

    try {
      artifacts.set(relativePath, transformArtifact(relativePath, JSON.parse(contents)));
    } catch (error) {
      throw new Error(`Failed to process ${relativePath}: ${error.message}`, { cause: error });
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

function buildFixtureMetadata(sourceRun) {
  return {
    fixture_id: FIXTURE_ID,
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

async function writeFixture(outputRoot, artifacts, metadata) {
  for (const relativePath of sourceFiles) {
    const destinationPath = resolve(outputRoot, relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, serializeJson(artifacts.get(relativePath)), "utf8");
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, "fixture.json"), serializeJson(metadata), "utf8");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sourceRun = toPortableWorkspacePath(options.source);
  const artifacts = await readSourceArtifacts(options.source);
  const metadata = buildFixtureMetadata(sourceRun);
  await writeFixture(options.output, artifacts, metadata);

  process.stdout.write(
    `Extracted ${artifacts.size} analyzer artifacts plus fixture.json to ${relative(process.cwd(), options.output) || "."}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Fixture extraction failed: ${error.message}\n`);
  process.exitCode = 1;
});
