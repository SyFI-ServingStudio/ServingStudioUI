import { describe, expect, it } from 'vitest';

import kernelTimeShareJson from '../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/kernel_time_share_composition.json';
import { decodeAnalyzerV1KernelTimeSharePayload } from '../../contracts/analyzer/v1/kernelTimeShare';
import type { KernelTimeShare } from '../../domain/kernelTimeShare';
import type { SubjectResult } from '../../domain/subject';
import { makeWorkerKey, makeWorkerRef } from '../../domain/worker';
import { hasReportableKernelTime, projectKernelTimeBreakdown } from './kernelTimeBreakdown';

function readySubject(payload: KernelTimeShare): SubjectResult<'kernelTimeShare'> {
  return { subject: 'kernelTimeShare', status: 'ready', schemaVersion: 1, payload };
}

function smallPayload(): KernelTimeShare {
  return {
    overall: {
      kernelTimeMs: 10,
      segments: [
        { position: 'a', kind: 'single_gemm', kernelTimeMs: 2, sharePct: 20 },
        { position: 'b', kind: 'grouped_gemm', kernelTimeMs: 3, sharePct: 30 },
        { position: 'c', kind: 'future_kernel', kernelTimeMs: 5, sharePct: 50 },
      ],
    },
    pools: [
      {
        poolTag: 'active',
        numWorkers: 1,
        kernelTimeMs: 10,
        segments: [
          { position: 'a', kind: 'single_gemm', kernelTimeMs: 2, sharePct: 20 },
          { position: 'b', kind: 'grouped_gemm', kernelTimeMs: 3, sharePct: 30 },
          { position: 'c', kind: 'future_kernel', kernelTimeMs: 5, sharePct: 50 },
        ],
      },
      { poolTag: 'idle', numWorkers: 1, kernelTimeMs: 0, segments: [] },
    ],
    workers: [
      {
        ref: makeWorkerRef('active', '0'),
        key: makeWorkerKey('active', '0'),
        rawRows: 4,
        sampledRows: 2,
        sampleStride: 2,
        kernelTimeMs: 10,
        segments: [
          { position: 'a', kind: 'single_gemm', kernelTimeMs: 2, sharePct: 20 },
          { position: 'b', kind: 'grouped_gemm', kernelTimeMs: 3, sharePct: 30 },
          { position: 'c', kind: 'future_kernel', kernelTimeMs: 5, sharePct: 50 },
        ],
      },
    ],
    positions: [
      { name: 'a', kind: 'single_gemm', overallSharePct: 20 },
      { name: 'b', kind: 'grouped_gemm', overallSharePct: 30 },
      { name: 'c', kind: 'future_kernel', overallSharePct: 50 },
    ],
    kernelTimeTotalsExact: true,
    sampling: {
      positionMixExact: true,
      method: 'all rows',
      rawRows: 3,
      sampledRows: 3,
      maxReplayRowsTarget: 10,
    },
    definitions: {},
  };
}

describe('projectKernelTimeBreakdown', () => {
  it('uses analyzer overall and pool scopes without applying GPU weights', () => {
    const decoded = decodeAnalyzerV1KernelTimeSharePayload(kernelTimeShareJson);
    expect(decoded.status).toBe('ready');
    if (decoded.status !== 'ready') return;

    const projection = projectKernelTimeBreakdown(decoded, { kind: 'cluster' });
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.rows.map((row) => row.label)).toEqual(['cluster', 'attn', 'ffn']);
    expect(projection.rows[0].total).toBeCloseTo(13_779_373.920275455, 6);
    expect(projection.rows[1].total).toBeCloseTo(11_167_952.16525611, 6);
    expect((projection.rows[0].byGroup.attn / projection.rows[0].total) * 100).toBeCloseTo(
      81.0483,
      4,
    );
    expect(projection.positionMixExact).toBe(false);
    expect(projection.kernelTimeTotalsExact).toBe(true);

    const attn = projectKernelTimeBreakdown(decoded, { kind: 'pool', poolTag: 'attn' });
    const ffn = projectKernelTimeBreakdown(decoded, { kind: 'pool', poolTag: 'ffn' });
    expect(attn.status).toBe('ready');
    expect(ffn.status).toBe('ready');
    if (attn.status !== 'ready' || ffn.status !== 'ready') return;
    expect(attn.families.map((family) => family.group)).toEqual(['attn']);
    expect(ffn.families.map((family) => family.group)).toEqual(['gemm', 'comm', 'norm']);
  });

  it('merges known kinds by family and places unknown kinds in misc deterministically', () => {
    const projection = projectKernelTimeBreakdown(readySubject(smallPayload()), {
      kind: 'cluster',
    });
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;

    expect(projection.families.map((family) => family.group)).toEqual(['gemm', 'misc']);
    expect(projection.rows[0]).toMatchObject({
      label: 'cluster',
      total: 10,
      byGroup: { gemm: 5, misc: 5 },
    });
    expect(projection.positionMixExact).toBe(true);
  });

  it('distinguishes a legal zero-time pool from a missing pool scope', () => {
    const subject = readySubject(smallPayload());
    const idle = projectKernelTimeBreakdown(subject, { kind: 'pool', poolTag: 'idle' });
    const missing = projectKernelTimeBreakdown(subject, { kind: 'pool', poolTag: 'other' });

    expect(idle).toMatchObject({ status: 'ready', rows: [{ label: 'idle', total: 0 }] });
    expect(missing).toEqual({
      status: 'scope_missing',
      reason: 'Kernel-time-share payload has no pool named other.',
    });
  });

  it('projects an exact worker identity and worker-local sampling counts', () => {
    const subject = readySubject(smallPayload());
    const workerKey = makeWorkerKey('active', '0');
    const worker = projectKernelTimeBreakdown(subject, { kind: 'worker', workerKey });
    const missing = projectKernelTimeBreakdown(subject, {
      kind: 'worker',
      workerKey: makeWorkerKey('active', '9'),
    });

    expect(worker).toMatchObject({
      status: 'ready',
      positionMixExact: false,
      sampling: { rawRows: 4, sampledRows: 2 },
      rows: [{ label: workerKey, total: 10 }],
    });
    expect(missing).toEqual({
      status: 'scope_missing',
      reason: 'Kernel-time-share payload has no worker active/9.',
    });
  });

  it('uses the analyzer epsilon when deciding whether a scope has reportable time', () => {
    const payload = smallPayload();
    const idlePool = payload.pools.find((pool) => pool.poolTag === 'idle');
    if (!idlePool) throw new Error('Expected idle test pool.');
    idlePool.kernelTimeMs = 5e-13;

    const projection = projectKernelTimeBreakdown(readySubject(payload), {
      kind: 'pool',
      poolTag: 'idle',
    });
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(hasReportableKernelTime(projection)).toBe(false);
  });

  it.each([
    { subject: 'kernelTimeShare', status: 'pending', reason: 'running' },
    { subject: 'kernelTimeShare', status: 'unavailable', reason: 'not applicable' },
    { subject: 'kernelTimeShare', status: 'not_generated', reason: 'not requested' },
    { subject: 'kernelTimeShare', status: 'failed', code: 'compute_failed', reason: 'failed' },
    { subject: 'kernelTimeShare', status: 'incompatible', reason: 'schema mismatch' },
  ] as const)('preserves the analyzer/UI $status state', (subject) => {
    const projection = projectKernelTimeBreakdown(subject as SubjectResult<'kernelTimeShare'>, {
      kind: 'cluster',
    });

    expect(projection).toEqual(subject);
  });
});
