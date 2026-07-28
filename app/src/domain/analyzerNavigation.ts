import { z } from 'zod';
import { evidenceRefV2Schema, type EvidenceRefV2, type RunEvidenceRefV2 } from './evidenceRef';

const nonEmptyString = z.string().min(1);
export { evidenceRefV2Schema, type EvidenceRefV2 } from './evidenceRef';

export const analyzerNavigateCommandV2Schema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v2'),
    requestId: nonEmptyString,
    type: z.literal('navigate'),
    target: evidenceRefV2Schema,
  })
  .strict();

export type AnalyzerNavigateCommandV2 = z.infer<typeof analyzerNavigateCommandV2Schema>;

export interface AnalyzerNavigationResultV2 {
  protocol: 'vibesim.analyzer/v2';
  requestId: string;
  type: 'navigation-result';
  status: 'ok' | 'not-found' | 'unavailable';
}

const AGGREGATE_PATH = '#/aggregate';
const RUN_PATH = '#/run';
export const ANALYZER_NAVIGATION_RESULT_EVENT = 'vibesim:analyzer-navigation-result';

export function analyzerEvidenceHref(target: EvidenceRefV2): string {
  const validated = evidenceRefV2Schema.parse(target);
  if (validated.kind === 'run') {
    const query = new URLSearchParams({
      workspace: validated.workspaceId,
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
  const query = new URLSearchParams({
    workspace: validated.workspaceId,
    experiment: validated.experimentId,
  });
  if (validated.panelId) query.set('panel', validated.panelId);
  if (validated.metricKey) query.set('metric', validated.metricKey);
  if (validated.statistic) query.set('statistic', validated.statistic);
  if (validated.runId) query.set('run', validated.runId);
  if (validated.coordinates) query.set('coordinates', JSON.stringify(validated.coordinates));
  return `${AGGREGATE_PATH}?${query.toString()}`;
}

export function evidenceRefFromHash(hash: string): EvidenceRefV2 | null {
  const [path, queryString = ''] = hash.split('?', 2);
  const query = new URLSearchParams(queryString);
  if (path === RUN_PATH) return runEvidenceRefFromQuery(query);
  if (path !== AGGREGATE_PATH) return null;
  const experimentId = query.get('experiment');
  const workspaceId = query.get('workspace');
  if (!workspaceId || !experimentId) return null;

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
    protocol: 'vibesim.analyzer/v2',
    kind: 'aggregate',
    workspaceId,
    experimentId,
    ...(query.get('panel') ? { panelId: query.get('panel') } : {}),
    ...(query.get('metric') ? { metricKey: query.get('metric') } : {}),
    ...(query.get('statistic') ? { statistic: query.get('statistic') } : {}),
    ...(query.get('run') ? { runId: query.get('run') } : {}),
    ...(coordinates === undefined ? {} : { coordinates }),
  };
  const parsed = evidenceRefV2Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function nullableNonnegativeNumber(value: string | null): number | null | undefined {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function runEvidenceRefFromQuery(query: URLSearchParams): RunEvidenceRefV2 | null {
  const workspaceId = query.get('workspace');
  const runId = query.get('run');
  const scope = query.get('scope');
  const workerAnalysisLevel = query.get('workerAnalysisLevel');
  if (!workspaceId || !runId || !scope || !workerAnalysisLevel) return null;
  const leafId = nullableNonnegativeNumber(query.get('leaf'));
  const parId = nullableNonnegativeNumber(query.get('parallel'));
  const cursorMs = nullableNonnegativeNumber(query.get('cursor'));
  if (leafId === undefined || parId === undefined || cursorMs === undefined) return null;
  const operationParts = [query.get('iter'), query.get('batch'), query.get('operation')];
  if (operationParts.some(Boolean) && !operationParts.every(Boolean)) return null;
  const candidate = {
    protocol: 'vibesim.analyzer/v2',
    kind: 'run',
    workspaceId,
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
  const parsed = evidenceRefV2Schema.safeParse(candidate);
  return parsed.success && parsed.data.kind === 'run' ? parsed.data : null;
}

/** URL replacement keeps manual evidence selection shareable without producing
 * a hashchange render loop. Agent commands use normal hash navigation instead. */
export function replaceAnalyzerEvidenceHref(target: EvidenceRefV2): void {
  window.history.replaceState(null, '', analyzerEvidenceHref(target));
}

export function navigationResult(
  requestId: string,
  status: AnalyzerNavigationResultV2['status'],
): AnalyzerNavigationResultV2 {
  return {
    protocol: 'vibesim.analyzer/v2',
    requestId,
    type: 'navigation-result',
    status,
  };
}
