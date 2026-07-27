import { z } from 'zod';
import { evidenceRefV1Schema, type EvidenceRefV1, type RunEvidenceRefV1 } from './evidenceRef';

const nonEmptyString = z.string().min(1);
export { evidenceRefV1Schema, type EvidenceRefV1 } from './evidenceRef';

export const analyzerNavigateCommandV1Schema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v1'),
    requestId: nonEmptyString,
    type: z.literal('navigate'),
    target: evidenceRefV1Schema,
  })
  .strict();

export type AnalyzerNavigateCommandV1 = z.infer<typeof analyzerNavigateCommandV1Schema>;

export interface AnalyzerNavigationResultV1 {
  protocol: 'vibesim.analyzer/v1';
  requestId: string;
  type: 'navigation-result';
  status: 'ok' | 'not-found' | 'unavailable';
}

const AGGREGATE_PATH = '#/aggregate';
const RUN_PATH = '#/run';
export const ANALYZER_NAVIGATION_RESULT_EVENT = 'vibesim:analyzer-navigation-result';

export function analyzerEvidenceHref(target: EvidenceRefV1): string {
  const validated = evidenceRefV1Schema.parse(target);
  if (validated.kind === 'run') {
    const query = new URLSearchParams({
      run: validated.runId,
      scope: validated.scope,
      cursorNeedsSeek: String(validated.cursorNeedsSeek),
      workerAnalysisLevel: validated.workerAnalysisLevel,
    });
    if (validated.panelId) query.set('panel', validated.panelId);
    if (validated.poolRole) query.set('pool', validated.poolRole);
    if (validated.workerKey) query.set('worker', validated.workerKey);
    if (validated.leafId !== null) query.set('leaf', String(validated.leafId));
    if (validated.parId !== null) query.set('parallel', String(validated.parId));
    if (validated.cursorMs !== null) query.set('cursor', String(validated.cursorMs));
    if (validated.operation) {
      query.set('iter', validated.operation.iterId);
      query.set('batch', validated.operation.batchId);
      query.set('operation', validated.operation.operationId);
    }
    return `${RUN_PATH}?${query.toString()}`;
  }
  const query = new URLSearchParams({ experiment: validated.experimentId });
  if (validated.panelId) query.set('panel', validated.panelId);
  if (validated.metricKey) query.set('metric', validated.metricKey);
  if (validated.statistic) query.set('statistic', validated.statistic);
  if (validated.runId) query.set('run', validated.runId);
  if (validated.coordinates) query.set('coordinates', JSON.stringify(validated.coordinates));
  return `${AGGREGATE_PATH}?${query.toString()}`;
}

export function evidenceRefFromHash(hash: string): EvidenceRefV1 | null {
  const [path, queryString = ''] = hash.split('?', 2);
  const query = new URLSearchParams(queryString);
  if (path === RUN_PATH) return runEvidenceRefFromQuery(query);
  if (path !== AGGREGATE_PATH) return null;
  const experimentId = query.get('experiment');
  if (!experimentId) return null;

  let coordinates: unknown;
  const encodedCoordinates = query.get('coordinates');
  if (encodedCoordinates !== null) {
    try {
      coordinates = JSON.parse(encodedCoordinates);
    } catch {
      return null;
    }
  }

  const candidate = {
    protocol: 'vibesim.analyzer/v1',
    kind: 'aggregate',
    experimentId,
    ...(query.get('panel') ? { panelId: query.get('panel') } : {}),
    ...(query.get('metric') ? { metricKey: query.get('metric') } : {}),
    ...(query.get('statistic') ? { statistic: query.get('statistic') } : {}),
    ...(query.get('run') ? { runId: query.get('run') } : {}),
    ...(coordinates === undefined ? {} : { coordinates }),
  };
  const parsed = evidenceRefV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function nullableNonnegativeNumber(value: string | null): number | null | undefined {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function runEvidenceRefFromQuery(query: URLSearchParams): RunEvidenceRefV1 | null {
  const runId = query.get('run');
  const scope = query.get('scope');
  const workerAnalysisLevel = query.get('workerAnalysisLevel');
  if (!runId || !scope || !workerAnalysisLevel) return null;
  const leafId = nullableNonnegativeNumber(query.get('leaf'));
  const parId = nullableNonnegativeNumber(query.get('parallel'));
  const cursorMs = nullableNonnegativeNumber(query.get('cursor'));
  if (leafId === undefined || parId === undefined || cursorMs === undefined) return null;
  const operationParts = [query.get('iter'), query.get('batch'), query.get('operation')];
  if (operationParts.some(Boolean) && !operationParts.every(Boolean)) return null;
  const candidate = {
    protocol: 'vibesim.analyzer/v1',
    kind: 'run',
    runId,
    panelId: query.get('panel'),
    scope,
    poolRole: query.get('pool'),
    workerKey: query.get('worker'),
    leafId,
    parId,
    cursorMs,
    cursorNeedsSeek: query.get('cursorNeedsSeek') === 'true',
    operation: operationParts.every(Boolean)
      ? {
          iterId: operationParts[0],
          batchId: operationParts[1],
          operationId: operationParts[2],
        }
      : null,
    workerAnalysisLevel,
  };
  const parsed = evidenceRefV1Schema.safeParse(candidate);
  return parsed.success && parsed.data.kind === 'run' ? parsed.data : null;
}

/** URL replacement keeps manual evidence selection shareable without producing
 * a hashchange render loop. Agent commands use normal hash navigation instead. */
export function replaceAnalyzerEvidenceHref(target: EvidenceRefV1): void {
  window.history.replaceState(null, '', analyzerEvidenceHref(target));
}

export function navigationResult(
  requestId: string,
  status: AnalyzerNavigationResultV1['status'],
): AnalyzerNavigationResultV1 {
  return {
    protocol: 'vibesim.analyzer/v1',
    requestId,
    type: 'navigation-result',
    status,
  };
}
