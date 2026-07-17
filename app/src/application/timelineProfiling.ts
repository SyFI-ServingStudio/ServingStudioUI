type TimelineInteractionSource = 'pointer' | 'keyboard' | 'input';

interface TimelineInteraction {
  id: string;
  source: TimelineInteractionSource;
  startedAt: number;
  active: boolean;
  inputCount: number;
  lastInputLogAt: number;
  events: TimelineTraceEvent[];
  flushed: boolean;
  cursorMs?: number;
  worker?: string;
}

interface TimelineTraceEvent {
  event: string;
  elapsed_ms: number;
  timestamp: string;
  payload: Record<string, unknown>;
}

const interactions = new Map<string, TimelineInteraction>();
let interactionSerial = 0;
let currentInteractionId: string | null = null;
const TRACE_FLUSH_DELAY_MS = 15_000;
// The temporary Analyzer sink deliberately rejects detail strings above 1024
// bytes. Leave headroom for UTF-8 and future compact fields.
const MAX_TRACE_DETAIL_BYTES = 1_000;

function now(): number {
  return performance.now();
}

function emit(
  interaction: TimelineInteraction,
  event: string,
  detail: Record<string, unknown>,
): void {
  const elapsedMs = now() - interaction.startedAt;
  const timestamp = new Date().toISOString();
  const payload = { source: interaction.source, ...detail };
  const cursorMs =
    typeof detail.cursorMs === 'number'
      ? detail.cursorMs
      : typeof detail.atMs === 'number'
        ? detail.atMs
        : undefined;
  const worker =
    typeof detail.poolTag === 'string' && typeof detail.workerId === 'string'
      ? `${detail.poolTag}/${detail.workerId}`
      : undefined;
  console.info(`[timeline-prof] ${interaction.id} +${elapsedMs.toFixed(1)}ms ${event}`, {
    timestamp,
    ...payload,
  });
  interaction.events.push({ event, elapsed_ms: elapsedMs, timestamp, payload });
  if (cursorMs !== undefined) interaction.cursorMs = cursorMs;
  if (worker !== undefined) interaction.worker = worker;
}

function boundedTraceDetail(events: readonly TimelineTraceEvent[]): string {
  const compactEvents = events.map(({ event, elapsed_ms: elapsedMs, payload }) => {
    const compactPayload = {
      ...('resource' in payload ? { r: payload.resource } : {}),
      ...('activeResources' in payload ? { x: payload.activeResources } : {}),
      ...('activeRequests' in payload ? { a: payload.activeRequests } : {}),
      ...('pendingRequests' in payload ? { q: payload.pendingRequests } : {}),
      ...('queueWaitMs' in payload ? { w: payload.queueWaitMs } : {}),
      ...('durationMs' in payload ? { d: payload.durationMs } : {}),
      ...('totalMs' in payload ? { d: payload.totalMs } : {}),
      ...('status' in payload ? { s: payload.status } : {}),
      ...('bytes' in payload ? { b: payload.bytes } : {}),
      ...('mode' in payload ? { m: payload.mode } : {}),
      ...('offset' in payload ? { o: payload.offset } : {}),
      ...('nearbyOffset' in payload ? { o: payload.nearbyOffset } : {}),
      ...('candidates' in payload ? { c: payload.candidates } : {}),
    };
    const roundedElapsedMs = Math.round(elapsedMs * 10) / 10;
    return Object.keys(compactPayload).length === 0
      ? ([roundedElapsedMs, event] as const)
      : ([roundedElapsedMs, event, compactPayload] as const);
  });
  const boundedEvents = [...compactEvents];
  let detail = JSON.stringify(boundedEvents);
  const lowValueEvents = new Set([
    'timeline-input',
    'cursor-store-updated',
    'interaction-input-end',
    'http-body-text-start',
    'http-json-decode-start',
  ]);
  // Preserve interaction-start and newest stages. Remove high-frequency or
  // start-marker events first, then the oldest remaining intermediate event.
  while (
    new TextEncoder().encode(detail).byteLength > MAX_TRACE_DETAIL_BYTES &&
    boundedEvents.length > 1
  ) {
    const lowValueIndex = boundedEvents.findIndex(
      (event, index) => index > 0 && lowValueEvents.has(event[1]),
    );
    boundedEvents.splice(lowValueIndex >= 0 ? lowValueIndex : 1, 1);
    detail = JSON.stringify(boundedEvents);
  }
  return detail;
}

function flushTimelineInteraction(interactionId: string): void {
  const interaction = interactions.get(interactionId);
  if (interaction === undefined || interaction.flushed) return;
  interaction.flushed = true;

  // One delayed request per interaction avoids competing with seek/page reads
  // for same-origin browser connections while those timings are measured.
  try {
    void globalThis
      .fetch('/api/v1/profile/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: interaction.id,
          event: 'interaction-trace',
          elapsed_ms: now() - interaction.startedAt,
          ...(interaction.cursorMs === undefined ? {} : { cursor_ms: interaction.cursorMs }),
          ...(interaction.worker === undefined ? {} : { worker: interaction.worker }),
          detail: boundedTraceDetail(interaction.events),
        }),
        keepalive: true,
      })
      .catch(() => undefined);
  } catch {
    // A missing/disabled fetch implementation is equivalent to unavailable
    // profiling transport; Console logging above remains the local fallback.
  }
}

/** Temporary manual-interaction profiler. The retained id lets async query
 * completions remain attributable after pointerup without affecting app state. */
export function beginTimelineInteraction(source: TimelineInteractionSource): string {
  const current =
    currentInteractionId === null ? undefined : interactions.get(currentInteractionId);
  if (current?.active) return current.id;

  interactionSerial += 1;
  const interaction: TimelineInteraction = {
    id: `timeline-${interactionSerial}`,
    source,
    startedAt: now(),
    active: true,
    inputCount: 0,
    lastInputLogAt: Number.NEGATIVE_INFINITY,
    events: [],
    flushed: false,
  };
  currentInteractionId = interaction.id;
  interactions.set(interaction.id, interaction);
  globalThis.setTimeout(() => flushTimelineInteraction(interaction.id), TRACE_FLUSH_DELAY_MS);
  if (interactions.size > 20) {
    const flushedInteraction = [...interactions.values()].find(
      (candidate) => candidate.flushed && candidate.id !== interaction.id,
    );
    if (flushedInteraction !== undefined) interactions.delete(flushedInteraction.id);
  }
  emit(interaction, 'interaction-start', {});
  return interaction.id;
}

export function recordTimelineInput(atMs: number): void {
  const interactionId = currentInteractionId ?? beginTimelineInteraction('input');
  const interaction = interactions.get(interactionId);
  if (interaction === undefined) return;

  interaction.inputCount += 1;
  const timestamp = now();
  // Dragging can produce hundreds of input events. Keep the first and a
  // periodic progress sample; interaction-end reports the exact total.
  if (interaction.inputCount === 1 || timestamp - interaction.lastInputLogAt >= 250) {
    interaction.lastInputLogAt = timestamp;
    emit(interaction, 'timeline-input', { atMs, inputCount: interaction.inputCount });
  }
}

export function endTimelineInteraction(atMs: number): void {
  if (currentInteractionId === null) return;
  const interaction = interactions.get(currentInteractionId);
  if (interaction === undefined || !interaction.active) return;
  interaction.active = false;
  emit(interaction, 'interaction-input-end', { atMs, inputCount: interaction.inputCount });
}

export function currentTimelineInteractionId(): string | null {
  return currentInteractionId;
}

export function timelineProfileEvent(
  event: string,
  detail: Record<string, unknown>,
  interactionId: string | null = currentInteractionId,
): void {
  if (interactionId === null) return;
  const interaction = interactions.get(interactionId);
  if (interaction !== undefined) emit(interaction, event, detail);
}
