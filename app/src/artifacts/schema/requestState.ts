/**
 * Where requests were waiting, schema 1 — the *report*, not the series.
 *
 * The Analyzer publishes both. The payload is 200 bins × every category ×
 * every worker (43 KB for a one-worker run, and it grows with the cluster);
 * the report is the same populations reduced to a time-weighted mean and an
 * exact pre-binning peak, a couple of kilobytes whatever the deployment. Two
 * numbers per population answer the question a reader opens this panel with —
 * how deep did the queue get, and was it deep the whole time or once — so the
 * report is what this build reads. The series is a chart, and a chart is a
 * different panel.
 *
 * ## What is cross-checked, and why these
 *
 * The document states the same quantity at three scopes, and the Analyzer
 * computes each independently:
 *
 * - a pool's mean total pending is the sum of its workers' (they are the same
 *   events, binned together rather than apart);
 * - a pool's `mean_pending_per_worker` is that total divided by its roster;
 * - a cluster category's mean is the sum of that category over every worker.
 *
 * A disagreement in any of them renders perfectly: a pool card that says 8
 * requests are queued over workers that add up to 3 is a page nobody can tell
 * is wrong. The peak is bounded rather than summed — the peak of a sum is not
 * the sum of the peaks, but it does lie between the largest worker's peak and
 * their total, and that bracket catches a peak attributed to the wrong scope.
 *
 * Everything here is a pure function of a parsed body.
 */
import { z } from 'zod';

import { segmentSchema } from '../../location';
import type {
  RequestPopulation,
  RequestStatePool,
  RequestStateTimeline,
  RequestStateWorker,
  RunRequestState,
} from '../ref';

export const REQUEST_STATE_SCHEMA_VERSION = 1;

/**
 * How far the independently-computed totals may drift apart.
 *
 * Relative and nothing else. Every quantity here is a sum or a maximum of
 * non-negative time-weighted counts, so the error is proportional to what is
 * being added: no cancellation, and a sum whose addends are all zero is exactly
 * zero rather than a few ulps away from it. That is what lets the absolute
 * floor go, and the floor had to go.
 *
 * At 1e-9 absolute it dominated whenever the counts themselves were that small
 * — which they legitimately can be, a request spending a microsecond in a stage
 * of a 512-second run averages about 2e-9 of a request. A cluster claiming
 * 1.1e-9 against pools holding 2e-9 passed as "equal", and the panel divided
 * one by the other and printed a pool holding 182% of the run's queue. Relative
 * tolerance refuses that report, which is where it has to be refused: the
 * display cannot tell a real ratio from a ratio of two roundings.
 */
const RELATIVE_TOLERANCE = 1e-6;

/** What a comparison at this magnitude may be out by. */
function slack(against: number): number {
  return RELATIVE_TOLERANCE * Math.abs(against);
}

/**
 * The category the Analyzer also publishes as each worker's queue depth.
 *
 * Named here because two fields carry it — `mean_pending` beside the
 * `pending` entry of `categories` — and the check below is that they agree. A
 * run whose stage vocabulary has no such category is not wrong; it simply has
 * nothing to cross-check, and the panel shows the populations it does have.
 */
const PENDING = 'pending';

/** Raised when the body parses but says something impossible. */
export class IncompatibleRequestStateError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`request-state artifact is not readable:\n${issues.map((i) => `- ${i}`).join('\n')}`);
    this.name = 'IncompatibleRequestStateError';
  }
}

/**
 * Raised when the analysis says it has nothing.
 *
 * Its own class, because "this run did not log stage transitions" is not a
 * failure of anything and must not be reported as one — the reader's next step
 * is a simulator setting, not a retry.
 */
export class UnavailableRequestStateError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableRequestStateError';
  }
}

const nonEmpty = z.string().min(1);
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const count = z.number().int().nonnegative().safe();

const populationSchema = z
  .object({ category: nonEmpty, mean: nonNegative, peak: nonNegative })
  .strict();

const poolSchema = z
  .object({
    pool: count,
    pool_tag: nonEmpty,
    n_workers: count.positive(),
    mean_total_pending: nonNegative,
    peak_total_pending: nonNegative,
    mean_pending_per_worker: nonNegative,
  })
  .strict();

const workerSchema = z
  .object({
    pool: count,
    pool_tag: nonEmpty,
    worker_id: count,
    mean_pending: nonNegative,
    peak_pending: nonNegative,
    categories: z.array(populationSchema).nonempty(),
  })
  .strict();

const reportSchema = z.object({
  schema_version: z.literal(REQUEST_STATE_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z
    .object({
      deployment: nonEmpty,
      requests_with_stage_history: count,
      transitions: count,
      span_ms: nonNegative,
      num_bins: count.positive(),
      bin_width_ms: nonNegative,
      aggregation: nonEmpty,
    })
    .passthrough(),
  totals: z.object({
    cluster_categories: z.array(populationSchema).nonempty(),
    pools: z.array(poolSchema).nonempty(),
    workers: z.array(workerSchema).nonempty(),
  }),
  definitions: z.record(nonEmpty),
});

/**
 * The unavailable form. `reason` sits at the top level here, not under `meta`
 * as the kernel-time subject spells it — this mirrors the Analyzer rather than
 * tidying it, because a schema that tidied would silently stop matching.
 */
const unavailableSchema = z.object({
  schema_version: z.literal(REQUEST_STATE_SCHEMA_VERSION),
  available: z.literal(false),
  reason: nonEmpty,
});

/** The version the body claims, when it claims one at all. */
export function requestStateVersion(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('schema_version' in body)) return undefined;
  const version = (body as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

export function parseRequestState(body: unknown): RunRequestState {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableRequestStateError(unavailable.data.reason);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleRequestStateError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      requestStateVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = reportIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleRequestStateError(issues, REQUEST_STATE_SCHEMA_VERSION);
  }
  return {
    cluster: wire.totals.cluster_categories.map(toPopulation),
    pools: wire.totals.pools.map((pool): RequestStatePool => ({
      poolTag: pool.pool_tag,
      workers: pool.n_workers,
      meanTotalPending: pool.mean_total_pending,
      peakTotalPending: pool.peak_total_pending,
      meanPendingPerWorker: pool.mean_pending_per_worker,
    })),
    workers: wire.totals.workers.map((worker): RequestStateWorker => ({
      poolTag: worker.pool_tag,
      workerId: String(worker.worker_id),
      meanPending: worker.mean_pending,
      peakPending: worker.peak_pending,
      categories: worker.categories.map(toPopulation),
    })),
    window: {
      spanMs: wire.meta.span_ms,
      bins: wire.meta.num_bins,
      binWidthMs: wire.meta.bin_width_ms,
    },
    requestsTracked: wire.meta.requests_with_stage_history,
    transitions: wire.meta.transitions,
    definitions: wire.definitions,
  };
}

const timelineCategorySchema = z.object({
  category: nonEmpty,
  values: z.array(nonNegative),
});

const timelineWorkerIdSchema = z.union([nonEmpty, count.transform(String)]);

const timelineWorkerSchema = z.object({
  worker_id: timelineWorkerIdSchema,
  pending: z.array(nonNegative),
  series: z.array(timelineCategorySchema).min(1),
});

const timelinePoolSchema = z.object({
  pool: count,
  pool_tag: nonEmpty,
  n_workers: count.positive(),
  total_pending: z.array(nonNegative),
  average_pending: z.array(nonNegative),
  workers: z.array(timelineWorkerSchema),
});

const modernTimelineMetaSchema = z.object({
  log_dir: nonEmpty,
  deployment: nonEmpty,
  requests_with_stage_history: count,
  transitions: count,
  span_ms: nonNegative,
  num_bins: count.positive(),
  bin_width_ms: nonNegative,
  aggregation: nonEmpty,
});

const legacyTimelineMetaSchema = z
  .object({
    log_dir: nonEmpty,
  })
  .strict();

const timelineSchema = z.object({
  schema_version: z.literal(REQUEST_STATE_SCHEMA_VERSION),
  meta: z.union([modernTimelineMetaSchema, legacyTimelineMetaSchema]),
  t_start_ms: z.array(nonNegative).min(1),
  t_end_ms: z.array(nonNegative).min(1),
  cluster_series: z.array(timelineCategorySchema).min(1),
  pools: z.array(timelinePoolSchema),
  definitions: z.record(nonEmpty).optional().default({}),
});

const unavailableTimelineSchema = z.object({
  schema_version: z.literal(REQUEST_STATE_SCHEMA_VERSION),
  meta: z.object({
    log_dir: nonEmpty,
    available: z.literal(false),
    reason: nonEmpty,
  }),
  t_start_ms: z.array(z.unknown()).length(0),
  t_end_ms: z.array(z.unknown()).length(0),
  cluster_series: z.array(z.unknown()).length(0),
  pools: z.array(z.unknown()).length(0),
});

type TimelineWire = z.infer<typeof timelineSchema>;

/** Decode the complete request population timelines used by the old scope charts. */
export function parseRequestStateSeries(body: unknown): RequestStateTimeline {
  const unavailable = unavailableTimelineSchema.safeParse(body);
  if (unavailable.success) {
    throw new UnavailableRequestStateError(unavailable.data.meta.reason);
  }
  const parsed = timelineSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleRequestStateError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      requestStateVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = timelineIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleRequestStateError(issues, REQUEST_STATE_SCHEMA_VERSION);
  }
  return {
    tStartMs: [...wire.t_start_ms],
    tEndMs: [...wire.t_end_ms],
    clusterSeries: wire.cluster_series.map(toTimelineCategory),
    pools: wire.pools.map((pool) => ({
      pool: pool.pool,
      poolTag: pool.pool_tag,
      workerCount: pool.n_workers,
      totalPending: [...pool.total_pending],
      averagePending: [...pool.average_pending],
      workers: pool.workers.map((worker) => ({
        worker: { poolTag: pool.pool_tag, workerId: worker.worker_id },
        pending: [...worker.pending],
        series: worker.series.map(toTimelineCategory),
      })),
    })),
    sourceLogDir: wire.meta.log_dir,
    deployment: 'deployment' in wire.meta ? wire.meta.deployment : null,
    requestsTracked:
      'requests_with_stage_history' in wire.meta ? wire.meta.requests_with_stage_history : null,
    transitions: 'transitions' in wire.meta ? wire.meta.transitions : null,
    window:
      'span_ms' in wire.meta
        ? {
            spanMs: wire.meta.span_ms,
            bins: wire.meta.num_bins,
            binWidthMs: wire.meta.bin_width_ms,
          }
        : null,
    aggregation: 'aggregation' in wire.meta ? wire.meta.aggregation : null,
    definitions: wire.definitions,
  };
}

function timelineIssues(wire: TimelineWire): string[] {
  const issues: string[] = [];
  const points = wire.t_start_ms.length;
  const categories = new Set<string>();
  wire.cluster_series.forEach((series, index) => {
    if (categories.has(series.category)) {
      issues.push(`cluster_series.${index}.category: duplicate ${series.category}`);
    }
    categories.add(series.category);
    checkTimelineLength(issues, `cluster_series.${index}.values`, series.values, points);
  });
  checkTimelineLength(issues, 't_end_ms', wire.t_end_ms, points);
  wire.t_start_ms.forEach((start, index) => {
    const end = wire.t_end_ms[index];
    if (end !== undefined && end <= start) {
      issues.push(`t_end_ms.${index}: must be greater than t_start_ms.${index}`);
    }
    if (index > 0 && !near(start, wire.t_end_ms[index - 1])) {
      issues.push(`t_start_ms.${index}: must equal the previous bin end`);
    }
  });

  const poolIds = new Set<number>();
  const poolTags = new Set<string>();
  wire.pools.forEach((pool, poolIndex) => {
    if (poolIds.has(pool.pool)) issues.push(`pools.${poolIndex}.pool: duplicate ${pool.pool}`);
    if (poolTags.has(pool.pool_tag)) {
      issues.push(`pools.${poolIndex}.pool_tag: duplicate ${pool.pool_tag}`);
    }
    poolIds.add(pool.pool);
    poolTags.add(pool.pool_tag);
    checkTimelineLength(issues, `pools.${poolIndex}.total_pending`, pool.total_pending, points);
    checkTimelineLength(issues, `pools.${poolIndex}.average_pending`, pool.average_pending, points);
    if (pool.workers.length !== pool.n_workers) {
      issues.push(
        `pools.${poolIndex}.workers: expected ${pool.n_workers}, got ${pool.workers.length}`,
      );
    }
    const workers = new Set<string>();
    pool.workers.forEach((worker, workerIndex) => {
      if (workers.has(worker.worker_id)) {
        issues.push(
          `pools.${poolIndex}.workers.${workerIndex}.worker_id: duplicate ${worker.worker_id}`,
        );
      }
      workers.add(worker.worker_id);
      checkTimelineLength(
        issues,
        `pools.${poolIndex}.workers.${workerIndex}.pending`,
        worker.pending,
        points,
      );
      const workerCategories = new Set<string>();
      worker.series.forEach((series, seriesIndex) => {
        if (workerCategories.has(series.category)) {
          issues.push(
            `pools.${poolIndex}.workers.${workerIndex}.series.${seriesIndex}.category: duplicate ${series.category}`,
          );
        }
        workerCategories.add(series.category);
        checkTimelineLength(
          issues,
          `pools.${poolIndex}.workers.${workerIndex}.series.${seriesIndex}.values`,
          series.values,
          points,
        );
      });
      const pending = worker.series.find((series) => series.category === PENDING);
      if (
        pending === undefined ||
        pending.values.some((value, index) => value !== worker.pending[index])
      ) {
        issues.push(
          `pools.${poolIndex}.workers.${workerIndex}.pending: must equal the pending category series`,
        );
      }
    });

    if (pool.workers.length === pool.n_workers) {
      pool.total_pending.forEach((total, bin) => {
        const workerTotal = sum(pool.workers.map((worker) => worker.pending[bin]));
        if (!near(total, workerTotal)) {
          issues.push(
            `pools.${poolIndex}.total_pending.${bin}: ${total} does not match worker sum ${workerTotal}`,
          );
        }
        const average = pool.average_pending[bin];
        const expectedAverage = total / pool.n_workers;
        if (average !== undefined && !near(average, expectedAverage)) {
          issues.push(
            `pools.${poolIndex}.average_pending.${bin}: ${average} does not match total / workers ${expectedAverage}`,
          );
        }
      });
    }
  });

  if (wire.pools.length > 0) {
    const clusterCategories = [...categories];
    wire.pools.forEach((pool, poolIndex) => {
      pool.workers.forEach((worker, workerIndex) => {
        const own = new Set(worker.series.map((series) => series.category));
        clusterCategories.forEach((category) => {
          if (!own.has(category)) {
            issues.push(
              `pools.${poolIndex}.workers.${workerIndex}.series: missing category ${category}`,
            );
          }
        });
        worker.series.forEach((series) => {
          if (!categories.has(series.category)) {
            issues.push(
              `pools.${poolIndex}.workers.${workerIndex}.series: unknown category ${series.category}`,
            );
          }
        });
      });
    });
    wire.cluster_series.forEach((cluster, clusterIndex) => {
      cluster.values.forEach((total, bin) => {
        const workerTotal = sum(
          wire.pools.flatMap((pool) =>
            pool.workers.map(
              (worker) =>
                worker.series.find((series) => series.category === cluster.category)?.values[bin] ??
                0,
            ),
          ),
        );
        if (!near(total, workerTotal)) {
          issues.push(
            `cluster_series.${clusterIndex}.values.${bin}: ${total} does not match worker sum ${workerTotal}`,
          );
        }
      });
    });
  }
  return issues;
}

function checkTimelineLength(
  issues: string[],
  where: string,
  values: readonly unknown[],
  expected: number,
): void {
  if (values.length !== expected) {
    issues.push(`${where}: has ${values.length} points, expected ${expected}`);
  }
}

function toTimelineCategory(wire: z.infer<typeof timelineCategorySchema>) {
  return { category: wire.category, values: [...wire.values] };
}

type Wire = z.infer<typeof reportSchema>;

function reportIssues(wire: Wire): string[] {
  const issues: string[] = [];
  const { cluster_categories: cluster, pools, workers } = wire.totals;

  // The window has to be the one the means were taken over. `bin_width_ms` is
  // `span_ms / num_bins` at the source, and a report whose three numbers do not
  // agree is describing a different aggregation than the one it names.
  const width = wire.meta.span_ms / wire.meta.num_bins;
  if (!near(wire.meta.bin_width_ms, width)) {
    issues.push(
      `meta: ${wire.meta.num_bins} bins of ${wire.meta.bin_width_ms} ms do not span ${wire.meta.span_ms} ms`,
    );
  }

  // One entry per category, because the vocabulary is a set: the Analyzer
  // derives it with `ordered_categories`, which keeps the first spelling of each
  // and drops the rest. A repeated category renders as two rows with the same
  // name and the same React key, and every reconciliation below reads it with
  // `.find`, so the first copy is checked and the second is added in — a pool
  // that shows twice the requests its workers hold, with nothing on screen to
  // say why.
  issues.push(...repeated('totals.cluster_categories', cluster));
  // Every request is in exactly one category at a time: the producer removes it
  // from the stage it is leaving before adding it to the one it is entering
  // (`build_event_set`). So no category can ever hold more requests than the run
  // tracked, and the categories together cannot either — the *sum of the means*
  // is the mean of a sum that is bounded at every instant.
  //
  // Without this the report can say the run tracked one request and 512 of them
  // finished, which the panel prints as a provenance line beside a breakdown it
  // contradicts.
  const tracked = wire.meta.requests_with_stage_history;
  for (const population of cluster) {
    if (population.peak > tracked + slack(tracked)) {
      issues.push(
        `totals.cluster_categories.${population.category}: peaks at ${population.peak} requests, above the ${tracked} the run tracked`,
      );
    }
  }
  const held = sum(cluster.map((population) => population.mean));
  if (held > tracked + slack(tracked)) {
    issues.push(
      `totals.cluster_categories: the categories average ${held} requests together, above the ${tracked} the run tracked`,
    );
  }
  for (const population of cluster) {
    if (population.mean > population.peak + slack(population.peak)) {
      issues.push(
        `totals.cluster_categories.${population.category}: mean ${population.mean} exceeds peak ${population.peak}`,
      );
    }
  }

  // A pool tag is written straight into the address — the panel's rows are
  // links down to the pool — so a tag the location parser will not read back is
  // a row that works once and 404s on the way home.
  const published = new Set<string>();
  for (const pool of pools) {
    if (published.has(pool.pool_tag)) {
      issues.push(`totals.pools: pool "${pool.pool_tag}" appears more than once`);
    }
    published.add(pool.pool_tag);
    if (!segmentSchema.safeParse({ at: 'pool', role: pool.pool_tag }).success) {
      issues.push(`totals.pools: pool tag "${clip(pool.pool_tag)}" cannot be put in an address`);
    }
    // A mean over a series cannot exceed that series' maximum. Both come from
    // one pass over one set of bin deltas at the source, so a pool reporting
    // otherwise is not reporting one pool — and this is the scope where the two
    // are drawn side by side, as "averaged 90, worst moment 80".
    if (pool.mean_total_pending > pool.peak_total_pending + slack(pool.peak_total_pending)) {
      issues.push(
        `totals.pools.${pool.pool_tag}: mean ${pool.mean_total_pending} exceeds peak ${pool.peak_total_pending}`,
      );
    }
    if (!near(pool.mean_pending_per_worker * pool.n_workers, pool.mean_total_pending)) {
      issues.push(
        `totals.pools.${pool.pool_tag}: ${pool.mean_pending_per_worker} per worker × ${pool.n_workers} workers is not the stated total ${pool.mean_total_pending}`,
      );
    }
  }

  const identities = new Set<string>();
  for (const worker of workers) {
    const identity = `${worker.pool_tag}/${worker.worker_id}`;
    if (identities.has(identity)) {
      issues.push(
        `totals.workers: pool "${worker.pool_tag}" lists worker ${worker.worker_id} more than once`,
      );
    }
    identities.add(identity);
    if (!published.has(worker.pool_tag)) {
      issues.push(
        `totals.workers: worker ${worker.worker_id} names pool "${worker.pool_tag}", which totals.pools does not publish`,
      );
    }
    if (worker.mean_pending > worker.peak_pending + slack(worker.peak_pending)) {
      issues.push(
        `totals.workers.${identity}: mean ${worker.mean_pending} exceeds peak ${worker.peak_pending}`,
      );
    }
    // And the same for every other population it reports. The queue is the one
    // this panel ranks by, so it was checked first; but a worker that averaged
    // six active requests while never holding more than five is describing two
    // different workers, and the reconciliations across scopes cannot see it —
    // a mean and a peak that are each individually plausible still add up and
    // bracket correctly.
    for (const population of worker.categories) {
      if (population.mean > population.peak + slack(population.peak)) {
        issues.push(
          `totals.workers.${identity}: "${population.category}" averages ${population.mean}, above its own peak ${population.peak}`,
        );
      }
    }
    issues.push(...repeated(`totals.workers.${identity}`, worker.categories));
  }

  for (const pool of pools) {
    const own = workers.filter((worker) => worker.pool_tag === pool.pool_tag);
    // Every worker of a published pool is listed — the Analyzer walks the whole
    // `run_meta` roster, not only the workers that saw traffic. A short list
    // would draw a pool with fewer workers than it ran, and the per-worker
    // averages beside it would still look consistent.
    if (own.length !== pool.n_workers) {
      issues.push(
        `totals: pool "${pool.pool_tag}" declares ${pool.n_workers} workers, but ${own.length} are listed`,
      );
      continue;
    }
    const summed = sum(own.map((worker) => worker.mean_pending));
    if (!near(summed, pool.mean_total_pending)) {
      issues.push(
        `totals: pool "${pool.pool_tag}" totals ${pool.mean_total_pending} pending, but its workers sum to ${summed}`,
      );
    }
    // The peak of a sum is neither the sum of the peaks nor the largest of
    // them, but it is between the two. Anything outside that bracket is a peak
    // that belongs to some other scope.
    const largest = Math.max(...own.map((worker) => worker.peak_pending));
    const ceiling = sum(own.map((worker) => worker.peak_pending));
    if (pool.peak_total_pending + slack(largest) < largest) {
      issues.push(
        `totals: pool "${pool.pool_tag}" peaks at ${pool.peak_total_pending} pending, below its busiest worker's ${largest}`,
      );
    } else if (pool.peak_total_pending > ceiling + slack(ceiling)) {
      issues.push(
        `totals: pool "${pool.pool_tag}" peaks at ${pool.peak_total_pending} pending, above the ${ceiling} its workers could contribute at once`,
      );
    }
  }

  // `mean_pending` is the `pending` category under another name — the Analyzer
  // bins the same events twice, once as the pool's queue and once as one
  // population among several. Two names for one number is two chances to show
  // a pool's queue depth beside a breakdown that contradicts it.
  for (const worker of workers) {
    const pending = worker.categories.find((own) => own.category === PENDING);
    if (pending === undefined) continue;
    if (!near(worker.mean_pending, pending.mean) || !near(worker.peak_pending, pending.peak)) {
      issues.push(
        `totals.workers.${worker.pool_tag}/${worker.worker_id}: pending queue (${worker.mean_pending}/${worker.peak_pending}) is not its "${PENDING}" population (${pending.mean}/${pending.peak})`,
      );
    }
  }

  // Every worker reports the same categories as the cluster, because the two
  // are built from one stage vocabulary. A worker missing one would make its
  // breakdown incomparable with the run's, in a card whose whole purpose is the
  // comparison.
  const categories = cluster.map((population) => population.category);
  for (const worker of workers) {
    const own = worker.categories.map((population) => population.category);
    if (own.length !== categories.length || own.some((name, at) => name !== categories[at])) {
      issues.push(
        `totals.workers.${worker.pool_tag}/${worker.worker_id}: categories [${own.join(', ')}] are not the run's [${categories.join(', ')}]`,
      );
    }
  }
  if (issues.length > 0) return issues;

  for (const population of cluster) {
    const own = workers.map((worker) =>
      worker.categories.find((entry) => entry.category === population.category),
    );
    const summed = sum(own.map((entry) => entry?.mean ?? 0));
    if (!near(summed, population.mean)) {
      issues.push(
        `totals: the run holds ${population.mean} requests in "${population.category}", but its workers sum to ${summed}`,
      );
    }
    // And the same bracket as a pool's, one level up. The cluster peak is an
    // exact sweep over the union of every worker's events for this category, so
    // it cannot be under the worst single worker nor over what they could hold
    // at once — and the run panel divides pool peaks by it, so a cluster peak
    // below its parts prints shares in the hundreds of percent.
    const peaks = own.map((entry) => entry?.peak ?? 0);
    const largest = Math.max(...peaks);
    const ceiling = sum(peaks);
    if (population.peak + slack(largest) < largest) {
      issues.push(
        `totals: the run peaks at ${population.peak} requests in "${population.category}", below its busiest worker's ${largest}`,
      );
    } else if (population.peak > ceiling + slack(ceiling)) {
      issues.push(
        `totals: the run peaks at ${population.peak} requests in "${population.category}", above the ${ceiling} its workers could hold at once`,
      );
    }
    if (population.category !== PENDING) continue;
    // The queue has a *second* decomposition, reported independently of the
    // workers: the pools, which are the rows this panel draws. The worker
    // bracket does not imply this one — a cluster peak comfortably between the
    // busiest worker and the workers' sum can still sit below the busiest pool
    // — and the run panel divides each pool peak by this number, so that gap
    // renders as a pool holding 150% of the run's queue.
    const poolPeaks = pools.map((pool) => pool.peak_total_pending);
    const worstPool = Math.max(...poolPeaks);
    const poolCeiling = sum(poolPeaks);
    if (population.peak + slack(worstPool) < worstPool) {
      issues.push(
        `totals: the run peaks at ${population.peak} pending, below its busiest pool's ${worstPool}`,
      );
    } else if (population.peak > poolCeiling + slack(poolCeiling)) {
      issues.push(
        `totals: the run peaks at ${population.peak} pending, above the ${poolCeiling} its pools could hold at once`,
      );
    }
  }
  return issues;
}

/** Any category named twice in one list, which the run's vocabulary cannot be. */
function repeated(
  where: string,
  populations: readonly z.infer<typeof populationSchema>[],
): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const population of populations) {
    if (seen.has(population.category)) twice.add(population.category);
    seen.add(population.category);
  }
  return [...twice].map((category) => `${where}: category "${category}" appears more than once`);
}

function toPopulation(wire: z.infer<typeof populationSchema>): RequestPopulation {
  return { category: wire.category, meanRequests: wire.mean, peakRequests: wire.peak };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Equal to within what independently-summed floating point can differ by. */
function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= slack(Math.max(Math.abs(left), Math.abs(right)));
}

/** Enough of an over-long token to recognise it by, without printing all of it. */
function clip(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`;
}
