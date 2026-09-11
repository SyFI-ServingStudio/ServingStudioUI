import { describe, expect, it } from 'vitest';

import type { CatalogEntry } from '../ref';
import { IncompatibleCatalogError, mergeCatalogs, parseCatalog } from './catalog';

function runBody(lifecycle: { simulation: string; analysis: string }) {
  return {
    protocol_version: 1,
    generated_at: '2026-09-01T00:00:00Z',
    runs: [
      {
        workspace_id: 'w_main',
        run_id: '20260715_1_afd',
        kind: 'simulation',
        display_name: 'AFD',
        lifecycle,
        updated_at: '2026-09-01T00:00:00Z',
      },
    ],
  };
}

describe('parseCatalog', () => {
  it('normalizes a run lifecycle into one status', () => {
    const complete = parseCatalog('run', runBody({ simulation: 'complete', analysis: 'complete' }));
    expect(complete.value[0]?.status).toBe('ready');

    const half = parseCatalog('run', runBody({ simulation: 'complete', analysis: 'pending' }));
    expect(half.value[0]?.status).toBe('partial');

    const failed = parseCatalog('run', runBody({ simulation: 'complete', analysis: 'failed' }));
    expect(failed.value[0]?.status).toBe('failed');

    const fresh = parseCatalog(
      'run',
      runBody({ simulation: 'not_started', analysis: 'not_started' }),
    );
    expect(fresh.value[0]?.status).toBe('not_started');
  });

  it('maps each kind onto the same row shape', () => {
    const parsed = parseCatalog('kernelProfile', {
      kernel_profiles: [
        {
          workspace_id: 'w_main',
          profile_id: 'kp_gemm',
          display_name: 'GEMM',
          status: 'complete',
          updated_at: '2026-08-30T12:00:00Z',
          kernel_kind: 'single_gemm',
          table: 'single_gemm',
          backend: 'torch',
          gpu_observed_name: 'NVIDIA H200',
        },
      ],
    });
    expect(parsed.value).toEqual([
      {
        kind: 'kernelProfile',
        id: 'kp_gemm',
        workspace: 'w_main',
        displayName: 'GEMM',
        status: 'ready',
        updatedAt: '2026-08-30T12:00:00Z',
        kernelKind: 'single_gemm',
        table: 'single_gemm',
        backend: 'torch',
        gpuName: 'NVIDIA H200',
      } satisfies CatalogEntry,
    ]);
  });

  it('reports an unrecognized status word as unknown rather than guessing', () => {
    const parsed = parseCatalog('prediction', {
      predictions: [
        {
          workspace_id: 'w_main',
          prediction_id: 'p_x',
          display_name: 'X',
          status: 'quarantined',
          updated_at: '2026-08-30T12:00:00Z',
          selector: 'iter',
          gpu: 'NVIDIA H200',
          case_count: 1,
        },
      ],
    });
    expect(parsed.value[0]?.status).toBe('unknown');
  });

  it('treats a kind an older Analyzer never publishes as empty, not as an error', () => {
    // The envelope key is absent entirely — the shape a build predating the
    // kind actually serves.
    expect(parseCatalog('sweep', { protocol_version: 1 }).value).toEqual([]);
  });

  it('retains the complete sweep header projection and rejects an incomplete current row', () => {
    const row = {
      workspace_id: 'w_main',
      sweep_id: 's_one',
      display_name: '20260901_2_tp_rate',
      status: 'ready',
      updated_at: '2026-09-01T00:00:00Z',
      num_runs: 6,
      deployments: ['unified'],
      traces: ['aime.csv'],
      axes: ['tensor_parallel', 'request_rate'],
      kind: 'sweep',
    };
    expect(parseCatalog('sweep', { sweeps: [row] }).value[0]).toMatchObject({
      numRuns: 6,
      deployments: ['unified'],
      traces: ['aime.csv'],
      axes: ['tensor_parallel', 'request_rate'],
    });
    const { num_runs: _missing, ...incomplete } = row;
    expect(() => parseCatalog('sweep', { sweeps: [incomplete] })).toThrow(/num_runs/);
  });

  it('retains the run identity of a singleton sweep', () => {
    const parsed = parseCatalog('sweep', {
      sweeps: [
        {
          workspace_id: 'w_main',
          sweep_id: 's_single',
          run_id: 'r_single',
          display_name: 'single run',
          status: 'ready',
          updated_at: '2026-09-01T00:00:00Z',
          num_runs: 1,
          deployments: ['unified'],
          traces: ['aime.csv'],
          axes: [],
          kind: 'sweep',
        },
      ],
    });
    expect(parsed.value[0]?.runId).toBe('r_single');
  });

  it('accepts an envelope with no protocol_version, since three endpoints send none', () => {
    const parsed = parseCatalog('alignment', {
      alignments: [
        {
          workspace_id: 'w_main',
          alignment_id: 'al_x',
          display_name: 'X',
          kernel_analysis: 'complete',
          e2e_analysis: 'not_started',
          updated_at: '2026-08-30T12:00:00Z',
        },
      ],
    });
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.value[0]?.status).toBe('partial');
  });

  it('rejects a protocol this build does not implement', () => {
    expect(() =>
      parseCatalog('run', {
        ...runBody({ simulation: 'complete', analysis: 'complete' }),
        protocol_version: 2,
      }),
    ).toThrow(IncompatibleCatalogError);
  });

  it('surfaces generated_at so a read can be told apart from the next one', () => {
    const parsed = parseCatalog('run', runBody({ simulation: 'complete', analysis: 'complete' }));
    expect(parsed.generatedAt).toBe('2026-09-01T00:00:00Z');
  });
});

describe('mergeCatalogs', () => {
  const entry = (id: string, updatedAt: string, kind: CatalogEntry['kind']): CatalogEntry => ({
    kind,
    id,
    workspace: 'w_main',
    displayName: id,
    status: 'ready',
    updatedAt,
  });

  it('orders newest first', () => {
    const merged = mergeCatalogs([
      [entry('old', '2026-01-01T00:00:00Z', 'run')],
      [entry('new', '2026-09-01T00:00:00Z', 'sweep')],
    ]);
    expect(merged.map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('is a function of its input alone when timestamps tie', () => {
    // A sweep and the runs it launched routinely share a timestamp. Without the
    // tiebreak the order would depend on which of the six reads settled first.
    const at = '2026-09-01T00:00:00Z';
    const a = mergeCatalogs([[entry('b', at, 'sweep')], [entry('a', at, 'run')]]);
    const b = mergeCatalogs([[entry('a', at, 'run')], [entry('b', at, 'sweep')]]);
    expect(a).toEqual(b);
    // Canonical kind order decides, not the order the reads settled: a sweep is
    // the thing a run belongs to, so it sorts above its runs.
    expect(a.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
