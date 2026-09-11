import { describe, expect, it } from 'vitest';

import realPayload from '../../../testdata/analyzer-v1/glm52-mtp-shape-refined/payloads/kernel_input_distribution_scatter.json';
import {
  IncompatibleKernelInputDistributionError,
  UnavailableKernelInputDistributionError,
  parseKernelInputDistribution,
} from './kernelInputDistribution';

const selection = (backendIndex = 0, backendName = 'first') => [
  { backend_index: backendIndex, backend_name: backendName, count: 2, ratio: 1 },
];

const point = (x: number, y: number, backendIndex = 0, backendName = 'first') => [
  { x, y, backend_index: backendIndex, backend_name: backendName, count: 2 },
];

export const KERNEL_INPUT_DISTRIBUTION_PAYLOAD = {
  schema_version: 1,
  available: true,
  meta: {
    log_dir: 'logs/test-run',
    sample_stride: 2,
    sampled_rows: 8,
    num_positions_plotted: 4,
    num_positions_multi_backend: 0,
    num_positions_manifest: 5,
    num_positions_omitted: 1,
    num_positions_without_candidates: 0,
    skipped_not_executed_slots: 3,
    skipped_empty_input_slots: 1,
    max_points_per_position: 6000,
  },
  positions: [
    {
      name: 'a.categorical',
      kind: 'categorical_kernel',
      candidate_backends: ['first'],
      selection: selection(),
      projection: 'categorical',
      axis_labels: ['(no numeric features)', ''],
      explained_variance: null,
      points: point(0, 0),
    },
    {
      name: 'b.feature',
      kind: 'feature_kernel',
      candidate_backends: ['first'],
      selection: selection(),
      projection: 'feature_1d',
      axis_labels: ['tokens', ''],
      explained_variance: null,
      points: point(16, 0),
    },
    {
      name: 'c.pca',
      kind: 'pca_kernel',
      candidate_backends: ['first'],
      selection: selection(),
      projection: 'pca',
      axis_labels: ['PC1', 'PC2'],
      explained_variance: [0.6, 0.3],
      points: point(-0.25, 0.5),
    },
    {
      name: 'd.raw',
      kind: 'raw_kernel',
      candidate_backends: ['first'],
      selection: selection(),
      projection: 'raw_2d',
      axis_labels: ['tokens', 'experts'],
      explained_variance: null,
      points: point(64, 8),
    },
  ],
  definitions: {
    scope: 'sampled cost-log slots grouped by tree position',
    position: 'the exact manifest position name',
    backend: 'the selected backend index',
    point: 'one deduplicated observation',
    features: 'numeric input features',
    projection: 'the display projection',
    sampling: 'bounded per-position sampling',
  },
} as const;

describe('parseKernelInputDistribution', () => {
  it('reads a complete production payload with all four projection modes', () => {
    const parsed = parseKernelInputDistribution(realPayload);
    expect(parsed).toMatchObject({
      sourceLogDir:
        '/raid/kanzhu/VibeSimWorkspace/wt-glm52-spec5/logs/20260830_1_glm52_diverse100_spec5/timing_predict_mtp_shape_refined',
      sampling: {
        stride: 1,
        sampledRows: 25,
        skippedNotExecutedSlots: 4375,
        skippedEmptyInputSlots: 0,
        maxPointsPerPosition: 6000,
      },
      positionCounts: {
        plotted: 319,
        multiBackend: 0,
        manifest: 377,
        omitted: 58,
        withoutCandidates: 0,
      },
    });
    expect(new Set(parsed.positions.map((position) => position.projection))).toEqual(
      new Set(['categorical', 'feature_1d', 'raw_2d', 'pca']),
    );
    expect(parsed.definitions).toEqual(realPayload.definitions);
  });

  it('preserves every producer metadata field in the domain value', () => {
    const parsed = parseKernelInputDistribution(KERNEL_INPUT_DISTRIBUTION_PAYLOAD);
    expect(parsed.positions).toHaveLength(4);
    expect(parsed.sampling).toEqual({
      stride: 2,
      sampledRows: 8,
      skippedNotExecutedSlots: 3,
      skippedEmptyInputSlots: 1,
      maxPointsPerPosition: 6000,
    });
    expect(parsed.positionCounts).toEqual({
      plotted: 4,
      multiBackend: 0,
      manifest: 5,
      omitted: 1,
      withoutCandidates: 0,
    });
  });

  it('maps the exact asymmetric producer unavailable payload separately', () => {
    expect(() =>
      parseKernelInputDistribution({
        schema_version: 1,
        meta: {
          log_dir: 'logs/old',
          available: false,
          reason: 'slot_backend is absent',
        },
        positions: [],
      }),
    ).toThrow(UnavailableKernelInputDistributionError);
  });

  it('rejects structural and producer-semantic contradictions with issue paths', () => {
    const bodies: unknown[] = [
      { ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD, extra: true },
      {
        ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD,
        definitions: { ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD.definitions, extra: 'unknown' },
      },
      {
        ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD,
        meta: { ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD.meta, num_positions_omitted: 2 },
      },
      {
        ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD,
        positions: [
          KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions[1],
          KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions[0],
          ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions.slice(2),
        ],
      },
      {
        ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD,
        positions: KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions.map((position, index) =>
          index === 1 ? { ...position, points: point(16, 1) } : position,
        ),
      },
      {
        ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD,
        positions: KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions.map((position, index) =>
          index === 2 ? { ...position, explained_variance: null } : position,
        ),
      },
      {
        ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD,
        positions: KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions.map((position, index) =>
          index === 3
            ? {
                ...position,
                selection: selection(255, 'candidate_255'),
                points: point(64, 8, 255, 'candidate_255'),
              }
            : position,
        ),
      },
    ];
    for (const body of bodies) {
      try {
        parseKernelInputDistribution(body);
        throw new Error('expected parseKernelInputDistribution to reject the payload');
      } catch (error) {
        expect(error).toBeInstanceOf(IncompatibleKernelInputDistributionError);
        expect(error).toMatchObject({ received: 1, issues: expect.any(Array) });
      }
    }
  });

  it('accepts an out-of-range candidate index when the producer uses its fallback name', () => {
    const fallbackPosition = {
      ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions[3],
      selection: selection(7, 'candidate_7'),
      points: point(64, 8, 7, 'candidate_7'),
    };
    const body = {
      ...KERNEL_INPUT_DISTRIBUTION_PAYLOAD,
      positions: [...KERNEL_INPUT_DISTRIBUTION_PAYLOAD.positions.slice(0, 3), fallbackPosition],
    };
    expect(parseKernelInputDistribution(body).positions[3]).toMatchObject({
      selection: [{ backendIndex: 7, backendName: 'candidate_7' }],
    });
  });
});
