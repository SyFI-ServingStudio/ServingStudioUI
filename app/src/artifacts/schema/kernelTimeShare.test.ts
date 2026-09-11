import { describe, expect, it } from 'vitest';

import clusterJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/kernel_time_share_composition.json';
import workerJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/kernel_time_share_worker_compositions.json';
import {
  IncompatibleKernelTimeShareError,
  UnavailableKernelTimeShareError,
  parseKernelTimeShare,
  parseWorkerKernelTimeShare,
} from './kernelTimeShare';

/** A mutable copy, so a test can break one rule without breaking the fixture. */
function cluster(): Record<string, never> {
  return structuredClone(clusterJson) as unknown as Record<string, never>;
}

function worker(key: string): Record<string, never> {
  const all = workerJson as unknown as Record<string, unknown>;
  const found = all[key];
  if (found === undefined) throw new Error(`No worker fixture for ${key}.`);
  return structuredClone(found) as Record<string, never>;
}

function issuesOf(read: () => unknown): string[] {
  try {
    read();
  } catch (error) {
    if (error instanceof IncompatibleKernelTimeShareError) return [...error.issues];
    throw error;
  }
  throw new Error('expected the read to be rejected');
}

describe('parseKernelTimeShare', () => {
  it('reads the real cluster payload and keeps every pool whole', () => {
    const share = parseKernelTimeShare(cluster());

    expect(share.pools).toHaveLength(2);
    expect(share.pools.every((pool) => pool.segments.length > 0)).toBe(true);
    expect(share.positions).toHaveLength(21);
    expect(share.workers).toHaveLength(10);
  });

  it('indexes workers without their compositions', () => {
    // This is the whole point of schema 2: the worker list is identity and
    // totals, and the segments live at each worker's own address.
    const share = parseKernelTimeShare(cluster());

    expect(share.workers[0]).toMatchObject({
      worker: { poolTag: 'attn', workerId: '0' },
      sampling: { stride: 220 },
    });
    expect(share.workers.every((entry) => !('segments' in entry))).toBe(true);
  });

  it('rejects a worker entry that still carries a composition', () => {
    const wire = cluster();
    (wire.workers as unknown as Record<string, unknown>[])[0].segments = [];

    expect(() => parseKernelTimeShare(wire)).toThrow(IncompatibleKernelTimeShareError);
  });

  it('still proves that workers sum to their pool and pools to the whole', () => {
    const wire = cluster();
    (wire.workers as unknown as Record<string, number>[])[0].kernel_time_ms += 1;

    expect(issuesOf(() => parseKernelTimeShare(wire)).join('\n')).toContain("is not its workers'");
  });

  it('checks a pool composition against the run position table', () => {
    const wire = cluster();
    const pool = (wire.pools as unknown as { segments: Record<string, string>[] }[])[0];
    pool.segments[0].position = 'a.position.this.run.does.not.have';

    expect(issuesOf(() => parseKernelTimeShare(wire)).join('\n')).toContain('unknown position');
  });

  it('proves the pools tell the same story about the mixture as the run', () => {
    // The totals can agree while the attribution does not: move one pool's time
    // from the position it was spent in to another, keep every scalar the same,
    // and the run bar and the pool bars below it describe two different runs.
    // This is the one level where the check is possible — a worker's segments
    // are at the worker's own address — which is why it is done here.
    const wire = cluster();
    const pool = (wire.pools as unknown as { segments: { position: string }[] }[])[0];
    pool.segments[1].position = pool.segments[0].position;

    expect(issuesOf(() => parseKernelTimeShare(wire)).join('\n')).toContain("is not the pools'");
  });

  it('refuses a pool tag that could not be put in an address', () => {
    // This panel is loaded on its own, so the topology's identical check is not
    // between the reader and a row that formats an address nothing can parse.
    const wire = cluster();
    const pools = wire.pools as unknown as { pool_tag: string }[];
    const workers = wire.workers as unknown as { pool_tag: string }[];
    const was = pools[0].pool_tag;
    pools[0].pool_tag = 'p'.repeat(200);
    for (const entry of workers) if (entry.pool_tag === was) entry.pool_tag = pools[0].pool_tag;

    expect(issuesOf(() => parseKernelTimeShare(wire)).join('\n')).toContain(
      'cannot be put in an address',
    );
  });

  it('refuses a pool tag that would rewrite the read’s own URL', () => {
    // `..` survives `encodeURIComponent` untouched, and even `%2E%2E` is
    // decoded and then resolved away, so `/workers/../0/subjects/x` reads
    // `/0/subjects/x` — a different route, with nothing anywhere saying so.
    const wire = cluster();
    const pools = wire.pools as unknown as { pool_tag: string }[];
    const workers = wire.workers as unknown as { pool_tag: string }[];
    const was = pools[0].pool_tag;
    pools[0].pool_tag = '..';
    for (const entry of workers) if (entry.pool_tag === was) entry.pool_tag = '..';

    expect(issuesOf(() => parseKernelTimeShare(wire)).join('\n')).toContain(
      'cannot be put in an address',
    );
  });

  it('reports an analysis that declares itself unavailable with its own reason', () => {
    // "no critical-path data" and "an empty critical path" are different facts.
    expect(() =>
      parseKernelTimeShare({
        schema_version: 2,
        available: false,
        meta: { reason: 'cost_log/ dir not found' },
      }),
    ).toThrow(UnavailableKernelTimeShareError);
  });

  it('names the version it received when it cannot read one', () => {
    const wire = cluster();
    wire.schema_version = 3 as never;

    try {
      parseKernelTimeShare(wire);
      throw new Error('expected the read to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleKernelTimeShareError);
      expect((error as IncompatibleKernelTimeShareError).received).toBe(3);
    }
  });
});

describe('parseWorkerKernelTimeShare', () => {
  it('reads one worker under the identity that was asked for', () => {
    const composition = parseWorkerKernelTimeShare(worker('attn/0'), {
      poolTag: 'attn',
      workerId: '0',
    });

    expect(composition.worker).toEqual({ poolTag: 'attn', workerId: '0' });
    expect(composition.segments.length).toBeGreaterThan(0);
    expect(composition.sampling.sampledRows).toBeLessThanOrEqual(composition.sampling.rawRows);
  });

  it('refuses a payload that describes a different worker', () => {
    expect(
      issuesOf(() =>
        parseWorkerKernelTimeShare(worker('attn/1'), { poolTag: 'attn', workerId: '0' }),
      ).join('\n'),
    ).toContain('describes attn/1, asked for attn/0');
  });

  it('checks the shares follow from the times', () => {
    const wire = worker('attn/0');
    (wire.segments as unknown as Record<string, number>[])[0].share_pct += 1;

    expect(
      issuesOf(() => parseWorkerKernelTimeShare(wire, { poolTag: 'attn', workerId: '0' })).join(
        '\n',
      ),
    ).toContain('does not follow from its kernel time');
  });

  it('does not pretend to check positions it was not given', () => {
    // A worker read carries no position table, so renaming a position cannot be
    // caught here — and rebuilding a table from these very segments to appear
    // to check it would be a check that can never fail.
    const wire = worker('attn/0');
    (wire.segments as unknown as Record<string, string>[])[0].position = 'renamed';

    expect(() =>
      parseWorkerKernelTimeShare(wire, { poolTag: 'attn', workerId: '0' }),
    ).not.toThrow();
  });
});
