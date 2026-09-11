/** Translate frozen session evidence into the current Location grammar. */
import type { z } from 'zod';

import { focusSchema, locationSchema } from '../location/types';
import type { ChatRef, Location, PanelOptions, ResultKind, Segment } from '../location/types';
import type {
  agentV1PredictionEvidenceRefSchema,
  agentV1RunEvidenceRefSchema,
  AgentV1EvidenceRef,
} from '../session/evidenceRef';

/** v2 selection kind to result kind. An alignment cannot be cited: v2 has no
 * shape for one, so no stored citation names one. */
const RESULT_KIND: Record<AgentV1EvidenceRef['kind'], ResultKind> = {
  aggregate: 'sweep',
  run: 'run',
  prediction: 'prediction',
  kernel_profile: 'kernelProfile',
  kernel_measurement: 'kernelMeasurement',
};

/**
 * A cursor that has no canonical URL spelling — `1e-7` — is dropped rather than
 * failing the whole citation. Losing the cursor still lands the reader on the
 * cited result; failing loses the link entirely.
 *
 * The rule is borrowed from `focusSchema` rather than restated, so a change to
 * what the URL accepts cannot leave a second copy of the rule behind here.
 */
function cursorOf(cursorMs: number | null): number | null {
  if (cursorMs === null) return null;
  const parsed = focusSchema.shape.cursorMs.safeParse(cursorMs);
  return parsed.success ? parsed.data : null;
}

function options(entries: readonly (readonly [string, string | undefined | null])[]): PanelOptions {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) result[key] = value;
  }
  return result;
}

/**
 * The run drill-down.
 *
 * `scope` is the authority for depth, not the presence of a field: the old model
 * kept `workerKey` set after the view returned to pool level, so honouring every
 * non-null field would cite a worker the author was no longer looking at. A
 * level whose parent is missing ends the path — a worker with no pool does not
 * identify a worker in this grammar.
 */
function runPath(reference: z.infer<typeof agentV1RunEvidenceRefSchema>): Segment[] {
  const path: Segment[] = [];
  if (reference.scope === 'cluster' || reference.poolRole === null) return path;
  const decodeToken = (value: string): string | null => {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  };
  if (reference.scope === 'pool' || reference.workerKey === null) {
    path.push({ at: 'pool', role: decodeToken(reference.poolRole) ?? reference.poolRole });
    return path;
  }
  // The frozen v2 evidence shape stores the two independently encoded components as
  // `<pool>/<worker>`, while Location carries decoded opaque tokens. Older
  // UI history keeps poolRole decoded; the Agent producer copied it from an
  // encoded resource path. Older hand-authored history may contain a bare
  // worker id, so accept that too.
  let workerId: string | null = null;
  let poolRole = reference.poolRole;
  const separator = reference.workerKey.indexOf('/');
  if (separator < 0) {
    workerId = reference.workerKey;
  } else if (separator === reference.workerKey.lastIndexOf('/')) {
    const pool = decodeToken(reference.workerKey.slice(0, separator));
    const worker = decodeToken(reference.workerKey.slice(separator + 1));
    const decodedRole = decodeToken(reference.poolRole);
    if (pool !== null && worker !== null) {
      if (pool === reference.poolRole) {
        workerId = worker;
      } else if (decodedRole !== null && pool === decodedRole) {
        poolRole = decodedRole;
        workerId = worker;
      }
    }
  }
  path.push({ at: 'pool', role: poolRole });
  if (!workerId) return path;
  path.push({ at: 'worker', id: workerId });
  if (reference.operation !== null) {
    path.push({
      at: 'operation',
      iter: reference.operation.iterId,
      batch: reference.operation.batchId,
      op: reference.operation.operationId,
    });
  }
  if (reference.scope === 'kernel' && reference.leafId !== null) {
    path.push({ at: 'leaf', id: reference.leafId });
  } else if (reference.scope === 'parallel' && reference.parId !== null) {
    path.push({ at: 'parallel', id: reference.parId });
  }
  return path;
}

/**
 * The prediction drill-down. A prediction ref has no `scope`, so depth is the
 * deepest chain of present fields; `leafId` wins over `parallelId` because the
 * two are alternative readings of the same node and the old UI resolved the tie
 * the same way.
 */
function predictionPath(reference: z.infer<typeof agentV1PredictionEvidenceRefSchema>): Segment[] {
  if (reference.caseId === null) return [];
  const path: Segment[] = [{ at: 'case', id: reference.caseId }];
  if (reference.operationId === null) return path;
  path.push({ at: 'caseOperation', id: reference.operationId });
  if (reference.leafId !== null) path.push({ at: 'leaf', id: reference.leafId });
  else if (reference.parallelId !== null) path.push({ at: 'parallel', id: reference.parallelId });
  return path;
}

interface Destination {
  id: string;
  path: Segment[];
  cursorMs: number | null;
  panel: string | null;
  options: PanelOptions;
}

function destinationOf(reference: AgentV1EvidenceRef): Destination {
  switch (reference.kind) {
    case 'aggregate':
      return {
        id: reference.experimentId,
        path:
          reference.runId === undefined && reference.coordinates === undefined
            ? []
            : [
                {
                  at: 'run',
                  ...(reference.runId === undefined ? {} : { id: reference.runId }),
                  ...(reference.coordinates === undefined
                    ? {}
                    : { coordinates: reference.coordinates }),
                },
              ],
        cursorMs: null,
        panel: 'sweep.page',
        options: options([
          ['metric', reference.metricKey],
          ['stat', reference.statistic],
          ['evidence-panel', reference.panelId],
        ]),
      };
    case 'run':
      return {
        id: reference.runId,
        path: runPath(reference),
        cursorMs: cursorOf(reference.cursorMs),
        panel: reference.panelId,
        options: {},
      };
    case 'prediction':
      return {
        id: reference.predictionId,
        path: predictionPath(reference),
        cursorMs: null,
        panel: reference.panelId,
        options: options([['optimality', reference.optimalityMode]]),
      };
    case 'kernel_profile':
      return {
        id: reference.profileId,
        path: [],
        cursorMs: null,
        panel: reference.panelId,
        options: options([['metric', reference.metricKey]]),
      };
    case 'kernel_measurement':
      return {
        id: reference.measurementId,
        path: [],
        cursorMs: null,
        panel: reference.panelId,
        options: options([
          ['metric', reference.metricKey],
          ['plot', reference.plotName],
        ]),
      };
  }
}

/**
 * A frozen citation into the Location it points at, or null if it points
 * nowhere this application can address — a workspace id that does not match the
 * backend's own pattern, a token longer than the URL grammar admits.
 *
 * Null rather than a throw: a stored citation is history and may predate any
 * rule here, and one unresolvable citation must render as inert text, not take
 * the conversation down with it.
 *
 * `chat` is a required argument because the answer is not derivable from the
 * reference. A citation clicked inside a docked conversation should keep that
 * conversation docked; the same reference opened from a link should not invent
 * one. Only the call site knows which case it is in.
 */
export function locationFromEvidenceRef(
  reference: AgentV1EvidenceRef,
  chat: ChatRef | null,
): Location | null {
  const destination = destinationOf(reference);
  const candidate = {
    view: 'result' as const,
    ref: {
      kind: RESULT_KIND[reference.kind],
      id: destination.id,
      workspace: reference.workspaceId,
    },
    focus: {
      path: destination.path,
      cursorMs: destination.cursorMs,
      panel: destination.panel,
      options: destination.options,
    },
    chat,
  };
  const parsed = locationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
