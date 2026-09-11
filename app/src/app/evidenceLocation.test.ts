import { describe, expect, it } from 'vitest';

import { formatLocation, type ChatRef } from '../location';
import { agentV1EvidenceRefSchema, type AgentV1EvidenceRef } from '../session/evidenceRef';
import { locationFromEvidenceRef } from './evidenceLocation';

const PROTOCOL = 'vibesim.analyzer/v2' as const;

function runRef(overrides: Partial<AgentV1EvidenceRef> = {}): AgentV1EvidenceRef {
  return agentV1EvidenceRefSchema.parse({
    protocol: PROTOCOL,
    kind: 'run',
    workspaceId: 'w_0123456789ab',
    runId: '20260715_1_test',
    panelId: null,
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    leafId: null,
    parId: null,
    cursorMs: null,
    cursorNeedsSeek: false,
    operation: null,
    workerAnalysisLevel: 'worker',
    ...overrides,
  });
}

/** Citations are read as an address, so assert the address, not the object. */
function addressOf(reference: AgentV1EvidenceRef, chat: ChatRef | null = null): string | null {
  const location = locationFromEvidenceRef(reference, chat);
  return location === null ? null : formatLocation(location);
}

describe('locationFromEvidenceRef', () => {
  it('translates a cluster-scoped run into a bare result address', () => {
    expect(addressOf(runRef())).toBe('#/result/run/20260715_1_test?w=w_0123456789ab');
  });

  it('carries the panel, the cursor and the drill-down path', () => {
    expect(
      addressOf(
        runRef({
          scope: 'worker',
          poolRole: 'decode',
          workerKey: '3',
          panelId: 'worker.kernel-time-share',
          cursorMs: 1250.5,
        }),
      ),
    ).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:decode.worker:3&t=1250.5&panel=worker.kernel-time-share',
    );
  });

  it('removes the repeated pool prefix from a frozen worker key', () => {
    expect(addressOf(runRef({ scope: 'worker', poolRole: 'decode', workerKey: 'decode/3' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:decode.worker:3',
    );
  });

  it('decodes both opaque components of a frozen worker key exactly once', () => {
    expect(addressOf(runRef({ scope: 'worker', poolRole: 'a b', workerKey: 'a%20b/x%2Fy' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:a%20b.worker:x%2Fy',
    );
  });

  it('decodes the Agent producer spelling whose poolRole came from an encoded URL', () => {
    expect(
      addressOf(runRef({ scope: 'worker', poolRole: 'a%20b', workerKey: 'a%20b/x%2Fy' })),
    ).toBe('#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:a%20b.worker:x%2Fy');
  });

  it('decodes an Agent producer pool-only path once', () => {
    expect(addressOf(runRef({ scope: 'pool', poolRole: 'a%20b' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:a%20b',
    );
  });

  it('stops before a malformed encoded or ambiguously separated worker key', () => {
    expect(addressOf(runRef({ scope: 'worker', poolRole: 'a b', workerKey: 'a%2/b' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:a%20b',
    );
    expect(addressOf(runRef({ scope: 'worker', poolRole: 'a', workerKey: 'a/b/c' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:a',
    );
  });

  it('does not attach a worker key that belongs to another pool', () => {
    expect(addressOf(runRef({ scope: 'worker', poolRole: 'decode', workerKey: 'prefill/3' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:decode',
    );
  });

  it('stops the path where a level has no parent', () => {
    // A worker with no pool does not identify a worker, so the path ends before it.
    expect(addressOf(runRef({ scope: 'worker', poolRole: null, workerKey: '3' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab',
    );
  });

  it('honours scope over stale deeper fields', () => {
    // The old model kept workerKey set after returning to pool level; citing the
    // worker would send the reader somewhere the author was not looking.
    expect(addressOf(runRef({ scope: 'pool', poolRole: 'decode', workerKey: '3' }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:decode',
    );
  });

  it('reaches a cost-tree leaf through its operation', () => {
    expect(
      addressOf(
        runRef({
          scope: 'kernel',
          poolRole: 'decode',
          workerKey: '3',
          operation: { iterId: '12', batchId: '4', operationId: '7' },
          leafId: 31,
        }),
      ),
    ).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:decode.worker:3.operation:12~4~7.leaf:31',
    );
  });

  it('takes the parallel node when that is the scope, ignoring the leaf', () => {
    expect(
      addressOf(
        runRef({
          scope: 'parallel',
          poolRole: 'decode',
          workerKey: '3',
          leafId: 31,
          parId: 8,
        }),
      ),
    ).toBe('#/result/run/20260715_1_test?w=w_0123456789ab&at=pool:decode.worker:3.parallel:8');
  });

  it('drops a cursor that has no canonical URL spelling', () => {
    // 1e-7 stringifies as "1e-7", which the hash grammar cannot round-trip.
    expect(addressOf(runRef({ cursorMs: 1e-7 }))).toBe(
      '#/result/run/20260715_1_test?w=w_0123456789ab',
    );
  });

  it('translates an aggregate citation into a sweep, with the run as a segment', () => {
    expect(
      addressOf(
        agentV1EvidenceRefSchema.parse({
          protocol: PROTOCOL,
          kind: 'aggregate',
          workspaceId: 'w_0123456789ab',
          experimentId: 'sweep-a',
          metricKey: 'throughput',
          statistic: 'p99',
          panelId: 'throughput',
          runId: '20260715_1_test',
          coordinates: { tp: 4, dtype: 'fp8' },
        }),
      ),
    ).toBe(
      '#/result/sweep/sweep-a?w=w_0123456789ab&at=run:20260715_1_test~%7B%22dtype%22%3A%22fp8%22%2C%22tp%22%3A4%7D' +
        '&panel=sweep.page&o.evidence-panel=throughput&o.metric=throughput&o.stat=p99',
    );
  });

  it('translates a prediction citation down to a case operation', () => {
    expect(
      addressOf(
        agentV1EvidenceRefSchema.parse({
          protocol: PROTOCOL,
          kind: 'prediction',
          workspaceId: 'w_0123456789ab',
          predictionId: 'pred-1',
          panelId: null,
          caseId: 'case-2',
          operationId: 'op-3',
          leafId: 5,
          parallelId: null,
          optimalityMode: 'batch_locked',
        }),
      ),
    ).toBe(
      '#/result/prediction/pred-1?w=w_0123456789ab&at=case:case-2.caseOperation:op-3.leaf:5&o.optimality=batch_locked',
    );
  });

  it('drops a prediction leaf that has no operation to hang from', () => {
    expect(
      addressOf(
        agentV1EvidenceRefSchema.parse({
          protocol: PROTOCOL,
          kind: 'prediction',
          workspaceId: 'w_0123456789ab',
          predictionId: 'pred-1',
          panelId: null,
          caseId: 'case-2',
          operationId: null,
          leafId: 5,
          parallelId: null,
          optimalityMode: 'unlocked',
        }),
      ),
    ).toBe('#/result/prediction/pred-1?w=w_0123456789ab&at=case:case-2&o.optimality=unlocked');
  });

  it.each([
    [
      'kernel profile',
      {
        protocol: PROTOCOL,
        kind: 'kernel_profile',
        workspaceId: 'w_0123456789ab',
        profileId: 'prof-1',
        panelId: null,
        metricKey: 'tflops',
      },
      '#/result/kernel-profile/prof-1?w=w_0123456789ab&o.metric=tflops',
    ],
    [
      'kernel measurement',
      {
        protocol: PROTOCOL,
        kind: 'kernel_measurement',
        workspaceId: 'w_0123456789ab',
        measurementId: 'meas-1',
        panelId: null,
        metricKey: 'tflops',
        plotName: 'roofline',
      },
      '#/result/kernel-measurement/meas-1?w=w_0123456789ab&o.metric=tflops&o.plot=roofline',
    ],
  ])('translates a %s citation', (_name, raw, expected) => {
    expect(addressOf(agentV1EvidenceRefSchema.parse(raw))).toBe(expected);
  });

  it('keeps a docked conversation docked', () => {
    const chat: ChatRef = { state: 'created', workspace: 'w_0123456789ab', id: 'c1' };
    expect(addressOf(runRef(), chat)).toBe('#/result/run/20260715_1_test?w=w_0123456789ab&chat=c1');
  });

  it('returns null for a workspace this application cannot address', () => {
    // Stored citations predate these rules; one bad citation must render as
    // inert text rather than take the conversation down with it.
    expect(locationFromEvidenceRef(runRef({ workspaceId: 'not-a-workspace' }), null)).toBeNull();
  });

  it('never translates the loading flag or the old worker analysis level', () => {
    // Neither has a home in a Location, and both would change what the reader
    // sees if they were smuggled in as options.
    const address = addressOf(runRef({ cursorNeedsSeek: true, workerAnalysisLevel: 'iteration' }));
    expect(address).toBe('#/result/run/20260715_1_test?w=w_0123456789ab');
  });
});

describe('agentV1EvidenceRefSchema', () => {
  it('rejects a reference carrying a field the backend never writes', () => {
    expect(agentV1EvidenceRefSchema.safeParse({ ...runRef(), unexpected: 'value' }).success).toBe(
      false,
    );
  });

  it('rejects a protocol it does not read', () => {
    expect(
      agentV1EvidenceRefSchema.safeParse({ ...runRef(), protocol: 'vibesim.analyzer/v1' }).success,
    ).toBe(false);
  });
});
