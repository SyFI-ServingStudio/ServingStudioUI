import { describe, expect, it } from 'vitest';

import { decodeAnalyzerV1KernelInputDistributionPayload } from './kernelInputDistribution';
import { decodeAnalyzerV1SubjectPayload } from './subjectDecoders';

function readyPayload(): Record<string, unknown> {
  return {
    schema_version: 1,
    available: true,
    meta: {
      log_dir: 'logs/run',
      sample_stride: 2,
      sampled_rows: 8,
      num_positions_plotted: 1,
      num_positions_multi_backend: 1,
      num_positions_manifest: 2,
      num_positions_omitted: 1,
      num_positions_without_candidates: 0,
      skipped_not_executed_slots: 3,
      skipped_empty_input_slots: 0,
      max_points_per_position: 6000,
    },
    positions: [
      {
        name: 'attention.prefill',
        kind: 'flashinfer_attn_prefill',
        candidate_backends: ['fa2', 'fa3'],
        selection: [
          { backend_index: 0, backend_name: 'fa2', count: 3, ratio: 0.75 },
          { backend_index: 1, backend_name: 'fa3', count: 1, ratio: 0.25 },
        ],
        projection: 'raw_2d',
        axis_labels: ['batch_size', 'total_tokens'],
        explained_variance: null,
        points: [
          { x: 2, y: 128, backend_index: 0, backend_name: 'fa2', count: 3 },
          { x: 4, y: 512, backend_index: 1, backend_name: 'fa3', count: 1 },
        ],
      },
    ],
    definitions: { point: 'one deduplicated input and backend observation' },
  };
}

describe('analyzer-v1 kernel input distribution adapter', () => {
  it('maps backend selection and projection points into the typed domain', () => {
    const result = decodeAnalyzerV1SubjectPayload('kernelInputDistribution', readyPayload(), {
      expectedLogDir: 'logs/run',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.sampling).toEqual({
      stride: 2,
      sampledRows: 8,
      maxPointsPerPosition: 6000,
    });
    expect(result.payload.positions[0]).toMatchObject({
      name: 'attention.prefill',
      projection: 'raw_2d',
      selection: [
        { backendIndex: 0, backendName: 'fa2', count: 3, ratio: 0.75 },
        { backendIndex: 1, backendName: 'fa3', count: 1, ratio: 0.25 },
      ],
      points: expect.arrayContaining([
        { x: 2, y: 128, backendIndex: 0, backendName: 'fa2', count: 3 },
      ]),
    });
  });

  it('preserves analyzer unavailable evidence', () => {
    const result = decodeAnalyzerV1KernelInputDistributionPayload({
      schema_version: 1,
      meta: { log_dir: 'logs/old', available: false, reason: 'slot_backend is absent' },
      positions: [],
    });

    expect(result).toEqual({
      subject: 'kernelInputDistribution',
      status: 'unavailable',
      reason: 'slot_backend is absent',
    });
  });

  it('rejects selection ratios that disagree with weighted point counts', () => {
    const wire = readyPayload();
    const positions = wire.positions as Array<{ selection: Array<{ ratio: number }> }>;
    positions[0].selection[0].ratio = 0.5;

    const result = decodeAnalyzerV1KernelInputDistributionPayload(wire);

    expect(result.status).toBe('incompatible');
    if (result.status !== 'incompatible') return;
    expect(result.reason).toContain('ratios sum');
    expect(result.reason).toContain('disagrees with count ratio');
  });

  it('rejects a PCA projection without explained variance', () => {
    const wire = readyPayload();
    const positions = wire.positions as Array<{
      projection: string;
      explained_variance: null;
    }>;
    positions[0].projection = 'pca';

    const result = decodeAnalyzerV1KernelInputDistributionPayload(wire);

    expect(result.status).toBe('incompatible');
    if (result.status !== 'incompatible') return;
    expect(result.reason).toContain('explained_variance: required for pca projection');
  });
});
