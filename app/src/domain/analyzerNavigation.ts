import { z } from 'zod';
import { analyzerCoordinateValueSchema } from './analyzerSelection';

const nonEmptyString = z.string().min(1);

export const evidenceRefV1Schema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v1'),
    experimentId: nonEmptyString,
    panelId: nonEmptyString.optional(),
    metricKey: nonEmptyString.optional(),
    statistic: z.enum(['mean', 'p99']).optional(),
    runId: nonEmptyString.optional(),
    coordinates: z.record(analyzerCoordinateValueSchema).optional(),
  })
  .strict();

export type EvidenceRefV1 = z.infer<typeof evidenceRefV1Schema>;

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
export const ANALYZER_NAVIGATION_RESULT_EVENT = 'vibesim:analyzer-navigation-result';

export function analyzerEvidenceHref(target: EvidenceRefV1): string {
  const validated = evidenceRefV1Schema.parse(target);
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
  if (path !== AGGREGATE_PATH) return null;
  const query = new URLSearchParams(queryString);
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
