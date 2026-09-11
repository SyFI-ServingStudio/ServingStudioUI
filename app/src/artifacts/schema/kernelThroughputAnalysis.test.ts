import { describe, expect, it } from 'vitest';

import { kernelThroughputAnalysisRef, predictionKernelThroughputAnalysisRef } from '../ref';
import {
  IncompatibleKernelThroughputAnalysisError,
  parseKernelThroughputAnalysis,
  parsePredictionKernelThroughputAnalysis,
} from './kernelThroughputAnalysis';

const REF = kernelThroughputAnalysisRef(
  { kind: 'run', id: 'run-1', workspace: 'w_main', revision: 'analysis-v2' },
  [
    { at: 'pool', role: 'ffn' },
    { at: 'worker', id: '2' },
    { at: 'operation', iter: '17', batch: '3', op: '1' },
    { at: 'leaf', id: 4 },
  ],
);

function body() {
  return {
    schema_version: 1,
    identity: {
      pool_tag: 'ffn',
      worker_id: 2,
      iter_id: 17,
      batch_id: 3,
      operation_id: 1,
      section: 'ffn',
      layer: 4,
    },
    leaf_id: 4,
    slot: {
      name: 'ffn.gemm',
      kind: 'single_gemm',
      kernel_config: { dtype: 'bf16' },
      backend: 'torch',
    },
    exact_input: { m: 2, n: 4 },
    describe_config: { dtype: 'bf16' },
    input_fields: ['m', 'n'],
    grid_axes: [[1, 2], [4]],
    points: [
      { input: { m: 1, n: 4 }, time_ms: 1, flops: 8, bytes: 4, energy_j: 0, coverage: 1 },
      { input: { m: 2, n: 4 }, time_ms: 2, flops: 16, bytes: 8, energy_j: 0, coverage: 2 },
    ],
    semantics: 'cache_eval_at_declared_grid' as const,
  };
}

describe('parseKernelThroughputAnalysis', () => {
  it('preserves exact identity, cache description, axes, and evaluated points', () => {
    expect(parseKernelThroughputAnalysis(body(), REF)).toMatchObject({
      worker: { poolTag: 'ffn', workerId: '2' },
      operation: { iterId: '17', batchId: '3', operationId: '1' },
      schemaVersion: 1,
      leafId: 4,
      describeConfig: { dtype: 'bf16' },
      inputFields: ['m', 'n'],
      gridAxes: [[1, 2], [4]],
      points: expect.arrayContaining([
        expect.objectContaining({ input: { m: 1, n: 4 }, timeMs: 1 }),
      ]),
    });
  });

  it('rejects a response substituted from another exact leaf', () => {
    const substituted = body();
    substituted.leaf_id = 5;
    expect(() => parseKernelThroughputAnalysis(substituted, REF)).toThrowError(
      IncompatibleKernelThroughputAnalysisError,
    );
    expect(() => parseKernelThroughputAnalysis(substituted, REF)).toThrow(/leaf:5.*leaf:4/);
  });

  it('rejects axes that do not align with fields or the Cartesian point count', () => {
    const missingAxis = body();
    missingAxis.grid_axes = [[1, 2]];
    expect(() => parseKernelThroughputAnalysis(missingAxis, REF)).toThrow(/expected 2 axes/);

    const missingPoint = body();
    missingPoint.points.pop();
    expect(() => parseKernelThroughputAnalysis(missingPoint, REF)).toThrow(
      /expected 2 grid points, got 1/,
    );
  });

  it('rejects a same-sized point set that is not the declared row-major grid', () => {
    const repeated = body();
    repeated.points[1].input = { m: 1, n: 4 };
    expect(() => parseKernelThroughputAnalysis(repeated, REF)).toThrow(
      /points\.1\.input\.m: expected row-major grid coordinate 2, got 1/,
    );

    const wrongFields = body();
    wrongFields.points[0].input = {
      m: 1,
      extra: 4,
    } as unknown as (typeof wrongFields.points)[0]['input'];
    expect(() => parseKernelThroughputAnalysis(wrongFields, REF)).toThrow(
      /expected exactly \[m, n\].*missing \[n\].*extra \[extra\]/,
    );
  });

  it('reports structural failures with the received schema version', () => {
    const malformed = body();
    malformed.points[0].time_ms = -1;
    try {
      parseKernelThroughputAnalysis(malformed, REF);
      throw new Error('expected parser to reject malformed point');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleKernelThroughputAnalysisError);
      expect(error).toMatchObject({ received: 1 });
      expect((error as IncompatibleKernelThroughputAnalysisError).issues.join('\n')).toContain(
        'points.0.time_ms',
      );
    }
  });

  it('does not coerce an invalid schema-version type into a received version', () => {
    const malformed = { ...body(), schema_version: '1' };
    try {
      parseKernelThroughputAnalysis(malformed, REF);
      throw new Error('expected parser to reject string schema version');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleKernelThroughputAnalysisError);
      expect(error).toMatchObject({ received: undefined });
    }
  });

  it('parses the prediction identity without inventing a worker coordinate', () => {
    const predictionBody = {
      ...body(),
      identity: {
        prediction_id: 'p_one',
        case_id: 17,
        operation_id: 1,
        section: 'ffn',
        layer: 4,
      },
    };
    const ref = predictionKernelThroughputAnalysisRef(
      { kind: 'prediction', id: 'p_one', workspace: 'w_main', revision: 'analysis-v2' },
      '17',
      '1',
      4,
    );
    expect(parsePredictionKernelThroughputAnalysis(predictionBody, ref)).toMatchObject({
      predictionId: 'p_one',
      caseId: '17',
      operationId: '1',
      leafId: 4,
      describeConfig: { dtype: 'bf16' },
    });
    const substituted = {
      ...predictionBody,
      identity: { ...predictionBody.identity, case_id: 18 },
    };
    expect(() => parsePredictionKernelThroughputAnalysis(substituted, ref)).toThrow(
      /p_one\/18\/1\/leaf:4.*p_one\/17\/1\/leaf:4/,
    );
  });
});
