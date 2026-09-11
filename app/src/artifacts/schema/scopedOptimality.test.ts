import { describe, expect, it } from 'vitest';

import {
  IncompatibleScopedOptimalityError,
  parseAnalyzerV1ScopedOptimality,
} from './scopedOptimality';

const body = {
  schema_version: 1,
  report_type: 'optimality_scoped_v1',
  selection: {
    selector: { path: 'attn/0', label: null },
    section: 'attn',
    canonical_path: 'attn/0',
    node_kind: 'sum',
    node_label: 'unified.qk_norm',
    matched_manifest_workers: 4,
    matched_cost_log_rows: 32,
    descendant_leaves: ['unified.qk_norm.q_norm'],
  },
  rungs: {
    r0_measured: { value_gpu_seconds: 0.5, unit: 'gpu_seconds', definition: 'measured' },
  },
  omitted_rungs: [{ rung: 'r7_scope_fused_necessary', reason: 'unavailable' }],
};

describe('parseAnalyzerV1ScopedOptimality', () => {
  it('projects the analyzer report into the artifact value', () => {
    expect(parseAnalyzerV1ScopedOptimality(body)).toMatchObject({
      section: 'attn',
      canonicalPath: 'attn/0',
      nodeLabel: 'unified.qk_norm',
      matchedWorkers: 4,
      matchedRows: 32,
      rungs: [{ key: 'r0_measured', gpuSeconds: 0.5, definition: 'measured' }],
    });
  });

  it('rejects incompatible schema versions with the received version', () => {
    expect(() => parseAnalyzerV1ScopedOptimality({ ...body, schema_version: 2 })).toThrow(
      IncompatibleScopedOptimalityError,
    );
    try {
      parseAnalyzerV1ScopedOptimality({ ...body, schema_version: 2 });
    } catch (error) {
      expect(error).toMatchObject({ received: 2 });
    }
  });
});
