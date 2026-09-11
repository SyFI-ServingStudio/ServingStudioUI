/**
 * Application decisions for links emitted by Agent turns.
 *
 * Stored citations use the backend's frozen v2 wire shape; managed-job cards
 * use event fields. Both become a Location here. The Markdown renderer only
 * reports clicks, and neither source knows how this application is routed.
 */
import { agentV1EvidenceRefSchema, type AgentV1EvidenceRef } from '../session/evidenceRef';
import {
  EMPTY_FOCUS,
  locationSchema,
  type ChatRef,
  type Location,
  type ResultKind,
} from '../location';
import type { ConversationCard } from '../panels/conversation/agentTimeline';
import { locationFromEvidenceRef } from './evidenceLocation';
import { resolveLocation } from './resolve';

export type EvidenceResolution =
  | { readonly status: 'ok'; readonly location: Extract<Location, { view: 'result' }> }
  | { readonly status: 'not-found' | 'unavailable' };

export interface EvidenceDestination {
  readonly location: Extract<Location, { view: 'result' }>;
  /** A citation opens the complete page with its evidence card selected, while
   * availability is checked against the one panel that owns that evidence. */
  readonly validationLocation?: Extract<Location, { view: 'result' }>;
  readonly knownUnavailable: boolean;
}

const RUN_PANEL_BY_SCOPE: Readonly<
  Record<string, Partial<Record<Extract<AgentV1EvidenceRef, { kind: 'run' }>['scope'], string>>>
> = {
  overview: { cluster: 'run.headline' },
  summary: { cluster: 'run.headline' },
  workload: { cluster: 'run.headline' },
  topology: { cluster: 'run.system-map' },
  model: { cluster: 'run.system-map' },
  total_tps: { cluster: 'run.headline' },
  tpot: { cluster: 'run.slo' },
  ttft: { cluster: 'run.slo' },
  'slo:ttft': { cluster: 'run.slo' },
  'slo:tpot': { cluster: 'run.slo' },
  'slo:e2e': { cluster: 'run.slo' },
  'slo-general': { cluster: 'run.slo' },
  throughput: { cluster: 'run.throughput' },
  concurrency: { cluster: 'run.timeline' },
  'workload-conservation': { cluster: 'run.checks' },
  utilization: {
    cluster: 'run.utilization',
    pool: 'pool.utilization',
    worker: 'worker.utilization',
  },
  'request-state': { cluster: 'run.queue', pool: 'pool.queue', worker: 'worker.queue' },
  'kv-cache': { pool: 'pool.kv', worker: 'worker.kv' },
  batch: { pool: 'pool.batch', worker: 'worker.batch' },
  'batch:total_tokens': { pool: 'pool.batch', worker: 'worker.batch' },
  'batch:prefill_tokens': { pool: 'pool.batch', worker: 'worker.batch' },
  'batch:decode_requests': { pool: 'pool.batch', worker: 'worker.batch' },
  'kernel-time-breakdown': {
    cluster: 'run.kernel-time',
    pool: 'pool.kernel-time',
    worker: 'worker.kernel-time-share',
    kernel: 'worker.kernel-time-share',
    parallel: 'worker.kernel-time-share',
  },
  'kernel-position-breakdown': {
    worker: 'worker.kernel-time-share',
    kernel: 'worker.kernel-time-share',
  },
  'optimality-breakdown': {
    cluster: 'run.optimality',
    pool: 'run.optimality',
    worker: 'run.optimality',
    kernel: 'run.optimality',
    parallel: 'run.optimality',
  },
  'optimality-kernel-ladder': {
    cluster: 'run.optimality',
    pool: 'run.optimality',
    worker: 'run.optimality',
    kernel: 'run.optimality',
    parallel: 'run.optimality',
  },
  'optimality-kernels': {
    cluster: 'run.optimality',
    pool: 'run.optimality',
    worker: 'run.optimality',
    kernel: 'run.optimality',
    parallel: 'run.optimality',
  },
  'cost-tree': {
    worker: 'worker.cost-tree',
    kernel: 'worker.cost-tree',
    parallel: 'worker.cost-tree',
  },
  'operation-timeline': {
    worker: 'worker.cost-tree',
    kernel: 'worker.cost-tree',
    parallel: 'worker.cost-tree',
  },
  'kernel-throughput': {
    worker: 'worker.cost-tree',
    kernel: 'worker.cost-tree',
    parallel: 'worker.cost-tree',
  },
};

const UNPORTED_RUN_PANELS = new Set(['kernel-input-distribution']);

function translateFrozenReference(reference: AgentV1EvidenceRef): {
  readonly reference: AgentV1EvidenceRef;
  readonly knownUnavailable: boolean;
} {
  if (reference.kind !== 'run') {
    // These ids are registered page-mode aliases. Keeping them preserves both
    // the cited selection and the panel's artifact availability check.
    if (reference.kind === 'kernel_profile' || reference.kind === 'kernel_measurement') {
      return { reference, knownUnavailable: false };
    }
    return { reference, knownUnavailable: false };
  }
  if (reference.panelId === null) return { reference, knownUnavailable: false };
  if (UNPORTED_RUN_PANELS.has(reference.panelId)) {
    return { reference: { ...reference, panelId: null }, knownUnavailable: true };
  }
  const panelId = RUN_PANEL_BY_SCOPE[reference.panelId]?.[reference.scope];
  const knownUnavailable = reference.panelId === 'batch' && panelId === undefined;
  return {
    reference:
      panelId === undefined && knownUnavailable
        ? { ...reference, panelId: null }
        : panelId === undefined
          ? reference
          : { ...reference, panelId },
    knownUnavailable,
  };
}

/**
 * Resolve one historical citation without writing browser state.
 *
 * Invalid historical bytes are not-found. A valid reference whose panel or
 * result kind this build has not ported is unavailable: the evidence exists,
 * but this application cannot display it yet.
 */
export async function resolveEvidence(
  target: unknown,
  chat: ChatRef | null,
  signal?: AbortSignal,
): Promise<EvidenceResolution> {
  const destination = evidenceDestination(target, chat);
  if (destination === null) return { status: 'not-found' };
  const status = await resolveLocation(
    destination.validationLocation ?? destination.location,
    signal,
  );
  if (status === 'ok' && destination.knownUnavailable) return { status: 'unavailable' };
  return status === 'ok' ? { status, location: destination.location } : { status };
}

/** Pure protocol translation, kept separate from artifact availability reads. */
export function evidenceDestination(
  target: unknown,
  chat: ChatRef | null,
): EvidenceDestination | null {
  const parsed = agentV1EvidenceRefSchema.safeParse(target);
  if (!parsed.success) return null;
  const translated = translateFrozenReference(parsed.data);
  const workspaceChat = chat?.workspace === translated.reference.workspaceId ? chat : null;
  const validationLocation = locationFromEvidenceRef(translated.reference, workspaceChat);
  if (validationLocation === null || validationLocation.view !== 'result') return null;
  if (parsed.data.kind !== 'run' || parsed.data.panelId === null) {
    return { location: validationLocation, knownUnavailable: translated.knownUnavailable };
  }
  const workbenchEvidence = new Set(['cost-tree', 'operation-timeline', 'kernel-throughput']);
  const location = {
    ...validationLocation,
    focus: {
      ...validationLocation.focus,
      panel: workbenchEvidence.has(parsed.data.panelId) ? validationLocation.focus.panel : null,
      options: {
        ...validationLocation.focus.options,
        'evidence-panel': parsed.data.panelId,
      },
    },
  };
  return {
    location,
    validationLocation,
    knownUnavailable: translated.knownUnavailable,
  };
}

const MANAGED_RESULT_KIND: Readonly<Record<string, ResultKind>> = {
  timing_predict: 'prediction',
  kernel_profile: 'kernelProfile',
  kernel_measure: 'kernelMeasurement',
};

/** The result opened by a completed managed-job card, if it names one. */
export function managedResultLocation(
  card: Extract<ConversationCard, { type: 'job' }>,
  chat: ChatRef | null,
): Extract<Location, { view: 'result' }> | null {
  const typed = card.jobKind !== undefined && card.resourceId !== undefined;
  const kind = card.jobKind === undefined ? undefined : MANAGED_RESULT_KIND[card.jobKind];
  if (typed && (kind === undefined || card.analyzerResourceId === undefined)) return null;
  if (!typed && !card.experimentId) return null;
  const workspaceChat = chat?.workspace === card.workspaceId ? chat : null;
  const candidate = {
    view: 'result',
    ref: {
      kind: typed ? kind! : 'sweep',
      id: typed ? card.analyzerResourceId! : card.experimentId,
      workspace: card.workspaceId,
    },
    focus: {
      ...EMPTY_FOCUS,
      options: kind === 'prediction' ? { optimality: 'unlocked' } : {},
    },
    chat: workspaceChat,
  };
  const parsed = locationSchema.safeParse(candidate);
  return parsed.success && parsed.data.view === 'result' ? parsed.data : null;
}
