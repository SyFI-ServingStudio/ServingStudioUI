import { afterEach, describe, expect, it, vi } from 'vitest';

import reportJson from '../../../e2e/fixtures/alignment/reports/alignment_workload_report.json';
import { fetchArtifact } from '../client';
import { alignmentWorkloadReportRef } from '../ref';
import { parseAnalyzerV1AlignmentWorkloadReport } from './alignment';

const ALIGNMENT = { kind: 'alignment', id: 'al_one', workspace: 'w_main' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseAnalyzerV1AlignmentWorkloadReport', () => {
  it('keeps the Analyzer percentiles of every scheduler field on both sides', () => {
    const report = parseAnalyzerV1AlignmentWorkloadReport(reportJson);
    expect(report.metrics.decode_batch_size.measured).toEqual({
      n: 2040,
      p50: 84,
      p90: 116,
      p99: 121,
      max: 124,
    });
    expect(Object.keys(report.metrics).sort()).toEqual([
      'decode_batch_size',
      'iteration_cycle_ms',
      'prefill_tokens',
      'scheduled_kv_tokens',
    ]);
  });

  it('reads a side that recorded no iteration as null statistics', () => {
    const empty = { n: 0, p50: null, p90: null, p99: null, max: null };
    const report = parseAnalyzerV1AlignmentWorkloadReport({
      ...reportJson,
      metrics: {
        ...reportJson.metrics,
        iteration_cycle_ms: { ...reportJson.metrics.iteration_cycle_ms, simulated: empty },
      },
    });
    expect(report.metrics.iteration_cycle_ms.simulated).toEqual(empty);
  });

  it('refuses a report missing a scheduler field or marked unavailable', () => {
    const { prefill_tokens: _dropped, ...rest } = reportJson.metrics;
    expect(() =>
      parseAnalyzerV1AlignmentWorkloadReport({ ...reportJson, metrics: rest }),
    ).toThrow();
    expect(() =>
      parseAnalyzerV1AlignmentWorkloadReport({ ...reportJson, available: false }),
    ).toThrow();
  });
});

it('reads the workload report at the subject report address', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(reportJson), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const result = await fetchArtifact(alignmentWorkloadReportRef(ALIGNMENT));
  expect(result.status).toBe('ready');
  expect(String(fetch.mock.calls[0][0])).toContain('/alignments/al_one/subjects/workload/report');
});
