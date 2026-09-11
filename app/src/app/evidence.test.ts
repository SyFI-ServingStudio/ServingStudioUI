import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatRef } from '../location';
import type { ConversationCard } from '../panels/conversation/agentTimeline';
import { evidenceDestination, managedResultLocation, resolveEvidence } from './evidence';

const CHAT: ChatRef = { state: 'created', workspace: 'w_main', id: 'c_one' };

function runCatalog(ids: readonly string[]): Response {
  return new Response(
    JSON.stringify({
      protocol_version: 1,
      generated_at: '2026-09-01T00:00:00Z',
      runs: ids.map((id) => ({
        workspace_id: 'w_main',
        run_id: id,
        display_name: id,
        lifecycle: { simulation: 'complete', analysis: 'complete' },
        updated_at: '2026-09-01T00:00:00Z',
      })),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function offlineCatalog(kind: 'kernel_profile' | 'kernel_measurement'): Response {
  const shared = {
    workspace_id: 'w_main',
    display_name: 'offline one',
    status: 'ready',
    updated_at: '2026-09-01T00:00:00Z',
    kernel_kind: 'gemm',
    table: 'single_gemm',
    backend: 'torch',
    metric_family: 'compute',
    gpu_observed_name: 'NVIDIA H200',
    gpu_cache_key: 'H200',
  };
  return new Response(
    JSON.stringify({
      protocol_version: 1,
      generated_at: '2026-09-01T00:00:00Z',
      ...(kind === 'kernel_profile'
        ? { kernel_profiles: [{ ...shared, profile_id: 'kp_one' }] }
        : { kernel_measurements: [{ ...shared, measurement_id: 'km_one' }] }),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('resolveEvidence', () => {
  it('preserves a frozen prediction panel, exact path, and optimality mode', () => {
    expect(
      evidenceDestination(
        {
          protocol: 'vibesim.analyzer/v2',
          kind: 'prediction',
          workspaceId: 'w_main',
          predictionId: 'p_one',
          panelId: 'optimality-kernel-ladder',
          caseId: '17',
          operationId: '2',
          leafId: 4,
          parallelId: null,
          optimalityMode: 'batch_locked',
        },
        CHAT,
      ),
    ).toEqual({
      knownUnavailable: false,
      location: {
        view: 'result',
        ref: { kind: 'prediction', id: 'p_one', workspace: 'w_main' },
        focus: {
          path: [
            { at: 'case', id: '17' },
            { at: 'caseOperation', id: '2' },
            { at: 'leaf', id: 4 },
          ],
          cursorMs: null,
          panel: 'optimality-kernel-ladder',
          options: { optimality: 'batch_locked' },
        },
        chat: CHAT,
      },
    });
  });

  it('turns a displayable frozen citation into a result Location and preserves its dock', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(runCatalog(['r_one'])));
    expect(
      await resolveEvidence(
        {
          protocol: 'vibesim.analyzer/v2',
          kind: 'run',
          workspaceId: 'w_main',
          runId: 'r_one',
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
        },
        CHAT,
      ),
    ).toEqual({
      status: 'ok',
      location: {
        view: 'result',
        ref: { kind: 'run', id: 'r_one', workspace: 'w_main' },
        focus: { path: [], cursorMs: null, panel: null, options: {} },
        chat: CHAT,
      },
    });
  });

  it('distinguishes malformed history from a valid result this build cannot display', async () => {
    expect(await resolveEvidence({ kind: 'run' }, CHAT)).toEqual({ status: 'not-found' });
    expect(
      await resolveEvidence(
        {
          protocol: 'vibesim.analyzer/v2',
          kind: 'aggregate',
          workspaceId: 'w_main',
          experimentId: 's_one',
        },
        CHAT,
      ),
    ).toEqual({ status: 'unavailable' });
  });

  it('does not carry a conversation into evidence from another workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            protocol_version: 1,
            runs: [
              {
                workspace_id: 'w_other',
                run_id: 'r_one',
                display_name: 'Other',
                lifecycle: { simulation: 'complete', analysis: 'complete' },
                updated_at: '2026-09-01T00:00:00Z',
              },
            ],
          }),
        ),
      ),
    );
    const target = {
      protocol: 'vibesim.analyzer/v2',
      kind: 'run',
      workspaceId: 'w_other',
      runId: 'r_one',
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
    };

    expect(await resolveEvidence(target, CHAT)).toMatchObject({
      status: 'ok',
      location: { chat: null },
    });
  });

  it('reports a missing result, an unknown panel, and a missing panel artifact separately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(runCatalog([])));
    const base = {
      protocol: 'vibesim.analyzer/v2',
      kind: 'run',
      workspaceId: 'w_main',
      runId: 'absent',
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
    };
    expect(await resolveEvidence(base, CHAT)).toEqual({ status: 'not-found' });
    expect(await resolveEvidence({ ...base, panelId: 'retired.panel' }, CHAT)).toEqual({
      status: 'not-found',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).endsWith('/runs')
          ? runCatalog(['r_one'])
          : new Response('', { status: 404, statusText: 'Not Found' }),
      ),
    );
    expect(
      await resolveEvidence({ ...base, runId: 'r_one', panelId: 'run.throughput' }, CHAT),
    ).toEqual({ status: 'unavailable' });
  });

  it.each([
    ['summary', 'cluster', 'run.headline'],
    ['workload', 'cluster', 'run.headline'],
    ['topology', 'cluster', 'run.system-map'],
    ['model', 'cluster', 'run.system-map'],
    ['slo-general', 'cluster', 'run.slo'],
    ['slo:ttft', 'cluster', 'run.slo'],
    ['slo:tpot', 'cluster', 'run.slo'],
    ['slo:e2e', 'cluster', 'run.slo'],
    ['throughput', 'cluster', 'run.throughput'],
    ['concurrency', 'cluster', 'run.timeline'],
    ['workload-conservation', 'cluster', 'run.checks'],
    ['utilization', 'pool', 'pool.utilization'],
    ['request-state', 'worker', 'worker.queue'],
    ['kv-cache', 'worker', 'worker.kv'],
    ['batch', 'worker', 'worker.batch'],
    ['batch:total_tokens', 'pool', 'pool.batch'],
    ['batch:prefill_tokens', 'worker', 'worker.batch'],
    ['batch:decode_requests', 'worker', 'worker.batch'],
    ['kernel-time-breakdown', 'kernel', 'worker.kernel-time-share'],
    ['kernel-position-breakdown', 'worker', 'worker.kernel-time-share'],
    ['optimality-breakdown', 'cluster', 'run.optimality'],
    ['optimality-kernel-ladder', 'worker', 'run.optimality'],
    ['optimality-kernels', 'kernel', 'run.optimality'],
    ['cost-tree', 'worker', 'worker.cost-tree'],
  ] as const)('maps frozen run panel %s at %s scope to %s', async (oldPanel, scope, panel) => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      requests.push(String(input));
      if (String(input).endsWith('/runs')) return runCatalog(['r_one']);
      return new Response('', { status: 404, statusText: 'Not Found' });
    });
    const workerScope = scope === 'worker' || scope === 'kernel';
    const target = {
      protocol: 'vibesim.analyzer/v2',
      kind: 'run',
      workspaceId: 'w_main',
      runId: 'r_one',
      panelId: oldPanel,
      scope,
      poolRole: scope === 'cluster' ? null : 'ffn',
      workerKey: workerScope ? 'ffn/0' : null,
      leafId: scope === 'kernel' ? 1 : null,
      parId: null,
      cursorMs: null,
      cursorNeedsSeek: false,
      operation: scope === 'kernel' ? { iterId: '0', batchId: '0', operationId: '0' } : null,
      workerAnalysisLevel: 'worker',
    };

    const destination = evidenceDestination(target, CHAT);
    expect(destination?.validationLocation?.focus.panel).toBe(panel);
    expect(destination?.location.focus.options['evidence-panel']).toBe(oldPanel);
    expect(destination?.location.focus.panel).toBe(oldPanel === 'cost-tree' ? panel : null);
    const result = await resolveEvidence(target, CHAT);
    // The artifact is deliberately 404: this asserts that resolution reached
    // the new panel and asked for its data instead of rejecting the old alias.
    expect(result).toEqual({ status: 'unavailable' });
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.join('\n')).not.toContain('ffn%2F0');
  });

  it('calls a cluster batch citation known but unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(runCatalog(['r_one'])));
    const target = {
      protocol: 'vibesim.analyzer/v2',
      kind: 'run',
      workspaceId: 'w_main',
      runId: 'r_one',
      panelId: 'batch',
      scope: 'cluster',
      poolRole: null,
      workerKey: null,
      leafId: null,
      parId: null,
      cursorMs: null,
      cursorNeedsSeek: false,
      operation: null,
      workerAnalysisLevel: 'worker',
    };
    expect(evidenceDestination(target, CHAT)).toMatchObject({ knownUnavailable: true });
    expect(await resolveEvidence(target, CHAT)).toEqual({ status: 'unavailable' });
  });

  it.each(['kernel-input-distribution'])(
    'calls known but unported frozen run panel %s unavailable',
    async (panelId) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(runCatalog(['r_one'])));
      const target = {
        protocol: 'vibesim.analyzer/v2',
        kind: 'run',
        workspaceId: 'w_main',
        runId: 'r_one',
        panelId,
        scope: 'cluster',
        poolRole: null,
        workerKey: null,
        leafId: null,
        parId: null,
        cursorMs: null,
        cursorNeedsSeek: false,
        operation: null,
        workerAnalysisLevel: 'worker',
      };
      expect(await resolveEvidence(target, CHAT)).toEqual({ status: 'unavailable' });
    },
  );

  it.each([
    [
      'curve',
      {
        protocol: 'vibesim.analyzer/v2',
        kind: 'kernel_profile',
        workspaceId: 'w_main',
        profileId: 'kp_one',
        panelId: 'curve',
        metricKey: 'tflops',
      },
      'metric',
      'tflops',
    ],
    [
      'summary',
      {
        protocol: 'vibesim.analyzer/v2',
        kind: 'kernel_measurement',
        workspaceId: 'w_main',
        measurementId: 'km_one',
        panelId: 'summary',
        metricKey: 'median',
        plotName: null,
      },
      'metric',
      'median',
    ],
    [
      'plot',
      {
        protocol: 'vibesim.analyzer/v2',
        kind: 'kernel_measurement',
        workspaceId: 'w_main',
        measurementId: 'km_one',
        panelId: 'plot',
        metricKey: null,
        plotName: 'runtime trend.png',
      },
      'plot',
      'runtime trend.png',
    ],
  ] as const)(
    'preserves frozen offline panel %s and resolves its declared artifacts',
    async (panel, target, option, value) => {
      const requests: string[] = [];
      vi.stubGlobal('fetch', async (input: string) => {
        const address = String(input);
        requests.push(address);
        if (address.endsWith('/kernel-profiles')) return offlineCatalog('kernel_profile');
        if (address.endsWith('/kernel-measurements')) return offlineCatalog('kernel_measurement');
        return new Response(
          JSON.stringify({ code: 'artifact_missing', detail: 'analysis was not generated' }),
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        );
      });

      expect(evidenceDestination(target, CHAT)?.location.focus).toMatchObject({
        panel,
        options: { [option]: value },
      });
      expect(await resolveEvidence(target, CHAT)).toEqual({ status: 'unavailable' });
      expect(requests.length).toBeGreaterThan(1);
    },
  );
});

describe('managedResultLocation', () => {
  function job(overrides: Partial<Extract<ConversationCard, { type: 'job' }>> = {}) {
    return {
      type: 'job' as const,
      workspaceId: 'w_main',
      experimentId: 'experiment_one',
      experimentPath: '/workspace/experiment_one',
      status: 'finished',
      ...overrides,
    };
  }

  it.each([
    ['timing_predict', 'prediction'],
    ['kernel_profile', 'kernelProfile'],
    ['kernel_measure', 'kernelMeasurement'],
  ] as const)('maps a %s job to the canonical %s result kind', (jobKind, resultKind) => {
    expect(
      managedResultLocation(
        job({ jobKind, resourceId: 'resource_one', analyzerResourceId: 'analyzer_one' }),
        CHAT,
      ),
    ).toMatchObject({
      ref: { kind: resultKind, id: 'analyzer_one', workspace: 'w_main' },
      chat: CHAT,
    });
  });

  it('opens an untyped simulation as a sweep and does not carry a foreign chat', () => {
    expect(managedResultLocation(job({ workspaceId: 'w_other' }), CHAT)).toMatchObject({
      ref: { kind: 'sweep', id: 'experiment_one', workspace: 'w_other' },
      chat: null,
    });
  });

  it('does not guess a destination for an unknown or unfinished typed job', () => {
    expect(managedResultLocation(job({ jobKind: 'future', resourceId: 'r' }), CHAT)).toBeNull();
    expect(
      managedResultLocation(job({ jobKind: 'kernel_profile', resourceId: 'r' }), CHAT),
    ).toBeNull();
  });

  it('rejects malformed identities from session history', () => {
    expect(managedResultLocation(job({ workspaceId: 'not-a-workspace' }), CHAT)).toBeNull();
    expect(
      managedResultLocation(
        job({
          jobKind: 'kernel_profile',
          resourceId: 'r',
          analyzerResourceId: '..',
        }),
        CHAT,
      ),
    ).toBeNull();
  });
});
