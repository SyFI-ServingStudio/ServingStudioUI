/**
 * The topology payload is two documents that must agree, and these tests are
 * almost entirely about what happens when they do not.
 *
 * The reason for that emphasis: every disagreement here renders. A pool whose
 * declared replicas do not match the workers that ran produces a map with a
 * worker missing, or a worker that cannot be opened, and nothing on the page
 * says so. Refusing the read is the only way the reader finds out.
 */
import { describe, expect, it } from 'vitest';

import { IncompatibleTopologyError, parseTopology } from './topology';

function body(params: unknown, runMeta: unknown): unknown {
  return {
    schema_version: 1,
    params:
      typeof params === 'object' && params !== null && !Array.isArray(params)
        ? { deployment: 'unified', ...params }
        : params,
    run_meta: runMeta,
  };
}

function group(over: Record<string, unknown> = {}): unknown {
  return {
    gpu: 'NVIDIA H200',
    replicas: 1,
    arch: { type: 'llama3_dense' },
    worker: { type: 'barebone' },
    ...over,
  };
}

function worker(id: number, tag: string, gpus: number[]): unknown {
  return { worker_id: id, pool_tag: tag, gpu_ids: gpus };
}

function gpu(id: number, tag: string, name = 'NVIDIA H200'): unknown {
  return { id, name, pool: 0, pool_tag: tag };
}

/** One pool, one worker, one GPU: the smallest run that is well formed. */
const SIMPLE = body(
  { pools: { main: { placement: 'least-queued', groups: [group()] } } },
  { gpus: [gpu(0, 'main')], workers: [worker(0, 'main', [0])] },
);

function refusal(payload: unknown): string {
  try {
    parseTopology(payload);
  } catch (error) {
    if (error instanceof IncompatibleTopologyError) return error.issues.join('; ');
    throw error;
  }
  throw new Error('expected the payload to be refused');
}

describe('parseTopology', () => {
  it('reads a single-worker run', () => {
    expect(parseTopology(SIMPLE)).toEqual({
      gpus: 1,
      deployment: 'unified',
      pools: [
        {
          tag: 'main',
          placement: 'least-queued',
          group: {
            gpu: 'NVIDIA H200',
            archType: 'llama3_dense',
            workerType: 'barebone',
            replicas: 1,
            gpusPerReplica: 1,
            params: {},
            workers: [{ id: '0', gpus: [0] }],
          },
        },
      ],
    });
  });

  it('carries architecture parameters it has never heard of', () => {
    // The vocabulary is per-architecture: one family spells tensor parallelism
    // `tp_size`, another `attn_tp`. A schema that listed the ones known today
    // would drop whatever the next family calls it, and the map would show a
    // 4-GPU worker with no sign of how the model was split across it.
    const parsed = parseTopology(
      body(
        {
          pools: {
            main: {
              groups: [group({ arch: { type: 'glm52_moe', tp_size: 4, mtp_mode: 'off' } })],
            },
          },
        },
        {
          gpus: [0, 1, 2, 3].map((id) => gpu(id, 'main')),
          workers: [worker(0, 'main', [0, 1, 2, 3])],
        },
      ),
    );
    expect(parsed.pools[0].group.params).toEqual({ tp_size: 4, mtp_mode: 'off' });
    // And the name is lifted out rather than left in with the rest.
    expect(parsed.pools[0].group.archType).toBe('glm52_moe');
  });

  it('orders pools by what ran, not by how params happens to be keyed', () => {
    // Object key order is not a reading order, and a pool declared but never
    // started is not part of this run at all.
    const parsed = parseTopology(
      body(
        {
          pools: {
            decode: { groups: [group()] },
            prefill: { groups: [group()] },
            unused: { groups: [group()] },
          },
        },
        {
          gpus: [gpu(0, 'prefill'), gpu(1, 'decode')],
          workers: [worker(0, 'prefill', [0]), worker(0, 'decode', [1])],
        },
      ),
    );
    expect(parsed.pools.map((pool) => pool.tag)).toEqual(['prefill', 'decode']);
  });

  it('refuses a pool whose replica count is not what ran', () => {
    // The map would draw two workers and offer an address for a third, or draw
    // three where two ran. Both render.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group({ replicas: 2 })] } } },
          { gpus: [gpu(0, 'main')], workers: [worker(0, 'main', [0])] },
        ),
      ),
    ).toContain('declares 2, but run_meta has 1 workers');
  });

  it('refuses a pool declaring two groups', () => {
    // `run_meta` carries no group identity, so there is no way to say which
    // workers belong to which — and assigning them by array position is a guess
    // that reads as a fact.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group(), group()] } } },
          { gpus: [gpu(0, 'main')], workers: [worker(0, 'main', [0])] },
        ),
      ),
    ).toContain('cannot identify 2 groups');
  });

  it('refuses a GPU whose model disagrees with the pool it is in', () => {
    // Kernel timings are read against the GPU the page names. Showing B200
    // numbers under an H200 heading is a wrong answer with no symptom.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group()] } } },
          { gpus: [gpu(0, 'main', 'NVIDIA B200')], workers: [worker(0, 'main', [0])] },
        ),
      ),
    ).toContain('NVIDIA B200 disagrees with params');
  });

  it('refuses a run whose GPUs are not all placed', () => {
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group()] } } },
          { gpus: [gpu(0, 'main'), gpu(1, 'main')], workers: [worker(0, 'main', [0])] },
        ),
      ),
    ).toContain('2 GPUs in the roster, 1 placed');
  });

  it('refuses a GPU placed on two workers', () => {
    // Two workers claiming one GPU means one of them did not have it, and the
    // page cannot tell the reader which.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group({ replicas: 2 })] } } },
          {
            gpus: [gpu(0, 'main')],
            workers: [worker(0, 'main', [0]), worker(1, 'main', [0])],
          },
        ),
      ),
    ).toContain('placed on more than one worker');
  });

  it('refuses a pool that lists one worker id twice', () => {
    // Two rows, one address. Every panel below the map reads `pool:main.worker:0`
    // and answers for whichever came first, and the other worker cannot be
    // opened at all — while the replica count says the pool is complete.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group({ replicas: 2 })] } } },
          {
            gpus: [gpu(0, 'main'), gpu(1, 'main')],
            workers: [worker(0, 'main', [0]), worker(0, 'main', [1])],
          },
        ),
      ),
    ).toContain('lists worker 0 more than once');
  });

  it('refuses a roster that names one GPU twice', () => {
    // Building the roster with `new Map` would keep the last row and count one
    // GPU, so a two-GPU worker on a one-GPU machine would draw without comment.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group()] } } },
          { gpus: [gpu(0, 'main'), gpu(0, 'main')], workers: [worker(0, 'main', [0])] },
        ),
      ),
    ).toContain('GPU 0 is listed more than once');
  });

  it('refuses a GPU the two documents place in different pools', () => {
    // The roster and the workers each say where this GPU is, and they disagree.
    // Whichever is right, one pool's card is counting hardware it did not have.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group()] } } },
          { gpus: [gpu(0, 'other')], workers: [worker(0, 'main', [0])] },
        ),
      ),
    ).toContain('the roster puts it in pool "other"');
  });

  it('refuses a pool tag that could not be put in an address', () => {
    // The map turns a tag into `#/result/run/…?at=pool:<tag>`, and the parser
    // that reads it back is bounded. Drawing the row anyway gives the reader a
    // link that works once and 404s when they come back to it.
    const long = 'p'.repeat(200);
    expect(
      refusal(
        body(
          { pools: { [long]: { groups: [group()] } } },
          { gpus: [gpu(0, long)], workers: [worker(0, long, [0])] },
        ),
      ),
    ).toContain('cannot be put in an address');
  });

  it('refuses a pool tag that would rewrite the read’s own URL', () => {
    // `..` survives `encodeURIComponent` untouched — a dot is unreserved — and
    // a hand-written `%2E%2E` is decoded and then resolved away, so
    // `/workers/../0/subjects/kernel-time-share` reads `/0/subjects/…`: another
    // route, another document, no error anywhere.
    expect(
      refusal(
        body(
          { pools: { '..': { groups: [group()] } } },
          { gpus: [gpu(0, '..')], workers: [worker(0, '..', [0])] },
        ),
      ),
    ).toContain('cannot be put in an address');
  });

  it('refuses a pool that ran but was never declared', () => {
    expect(
      refusal(body({ pools: {} }, { gpus: [gpu(0, 'main')], workers: [worker(0, 'main', [0])] })),
    ).toContain('which params does not declare');
  });

  it('refuses workers of differing width in one pool', () => {
    // The pool declares one group, so its workers are one shape. Two shapes
    // means the payload is describing something this model cannot express.
    expect(
      refusal(
        body(
          { pools: { main: { groups: [group({ replicas: 2 })] } } },
          {
            gpus: [0, 1, 2].map((id) => gpu(id, 'main')),
            workers: [worker(0, 'main', [0]), worker(1, 'main', [1, 2])],
          },
        ),
      ),
    ).toContain('do not have a uniform GPU count');
  });

  it('reports a schema version it does not read as the version it got', () => {
    // So the shell can say "this Analyzer is newer than this build" rather than
    // "the payload is malformed", which sends the reader looking at the run.
    try {
      parseTopology({ ...(SIMPLE as object), schema_version: 2 });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleTopologyError);
      expect((error as IncompatibleTopologyError).received).toBe(2);
    }
  });

  it('names the placement policy of a pool that declared none', () => {
    // `placement` is optional in the wire form and the map prints it verbatim;
    // an empty string would render as a policy named nothing at all.
    const parsed = parseTopology(
      body(
        { pools: { main: { groups: [group()] } } },
        { gpus: [gpu(0, 'main')], workers: [worker(0, 'main', [0])] },
      ),
    );
    expect(parsed.pools[0].placement).toBe('unspecified');
  });
});
