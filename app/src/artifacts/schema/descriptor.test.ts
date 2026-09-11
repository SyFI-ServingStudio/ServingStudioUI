import { describe, expect, it } from 'vitest';

import realDescriptor from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/run_descriptor.json';

import { parseAnalyzerV1RunDescriptor } from './descriptor';

function validWireDescriptor(): Record<string, unknown> {
  return {
    protocol_version: 1,
    workspace_id: 'w_main',
    run_id: '20260715_1_test',
    kind: 'simulation',
    display_name: 'Test run',
    model_name: 'model/test.json',
    deployment: 'afd',
    lifecycle: { simulation: 'complete', analysis: 'complete' },
    summary: { views: ['report'], media_type: 'application/json' },
    model: { views: ['payload'], schema_version: 1 },
    workload: { views: ['payload'], schema_version: 1 },
    topology: { views: ['payload'] },
    workers: [
      { pool_tag: 'attn', worker_id: 0 },
      { pool_tag: 'ffn', worker_id: 0 },
    ],
    subjects: {
      'slo-general': {
        status: 'ready',
        schema_version: 1,
        views: ['report', 'payload'],
        variants: {
          batch_locked: { views: ['report', 'payload'] },
        },
      },
      backpressure: {
        status: 'unavailable',
        code: 'missing_queue_events',
        reason: 'Queue events were not logged.',
      },
    },
    details: {
      'worker-cost-tree': {
        status: 'not_generated',
        reason: 'No hierarchical worker tree was generated.',
      },
    },
    traces: {
      perfetto: { status: 'not_generated', reason: 'No trace was requested.' },
    },
    provenance: {
      source: 'analyzer',
      synthetic: false,
      generator_version: 'test',
    },
    analysis: {
      revision: 'test-revision',
      generated_at: '2026-07-15T05:11:53Z',
      generator_version: 'test',
    },
  };
}

describe('parseAnalyzerV1RunDescriptor', () => {
  it('parses the complete checked-in analyzer descriptor', () => {
    const descriptor = parseAnalyzerV1RunDescriptor(realDescriptor);

    expect(descriptor).toMatchObject({
      protocolVersion: 1,
      workspaceId: 'w_main',
      runId: 'fixture-afd-qwen3-v1',
      deployment: 'afd',
      workers: expect.arrayContaining([{ poolTag: 'ffn', workerId: '1' }]),
      subjects: {
        kernelThroughput: { status: 'ready', schemaVersion: 1 },
        kernelInputDistribution: {
          status: 'unavailable',
          code: 'missing_kernel_input_columns',
        },
      },
      details: { 'worker-cost-tree': { status: 'not_generated' } },
    });
    expect(descriptor.subjects).not.toHaveProperty('slo-detailed');
  });

  it('maps the strict snake-case wire contract without collapsing worker identity', () => {
    const descriptor = parseAnalyzerV1RunDescriptor(validWireDescriptor());

    expect(descriptor).toMatchObject({
      protocolVersion: 1,
      workspaceId: 'w_main',
      runId: '20260715_1_test',
      modelName: 'model/test.json',
      deployment: 'afd',
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      model: { views: ['payload'], schemaVersion: 1 },
      workload: { views: ['payload'], schemaVersion: 1 },
      workers: [
        { poolTag: 'attn', workerId: '0' },
        { poolTag: 'ffn', workerId: '0' },
      ],
    });
    expect(descriptor.subjects.slo).toMatchObject({ status: 'ready', schemaVersion: 1 });
    expect(
      descriptor.subjects.slo?.status === 'ready'
        ? descriptor.subjects.slo.variants?.batch_locked
        : undefined,
    ).toEqual({ views: ['report', 'payload'] });
    expect(descriptor.subjects.backpressure).toEqual({
      status: 'unavailable',
      code: 'missing_queue_events',
      reason: 'Queue events were not logged.',
    });
    expect(descriptor.details['worker-cost-tree']).toMatchObject({
      status: 'not_generated',
    });
    expect(descriptor.analysis).toEqual({
      revision: 'test-revision',
      generatedAt: '2026-07-15T05:11:53Z',
      generatorVersion: 'test',
    });
  });

  it('accepts PD and ignores analyzer subjects with no UI consumer', () => {
    const wire = validWireDescriptor();
    wire.deployment = 'pd';
    wire.subjects = {
      ...(wire.subjects as Record<string, unknown>),
      'slo-detailed': {
        status: 'ready-v2',
        artifacts: [{ role: 'token-timing', href: 'future/token-timing.arrow' }],
      },
      ' slo-general ': { status: 'not_generated' },
    };

    const descriptor = parseAnalyzerV1RunDescriptor(wire);
    expect(descriptor.deployment).toBe('pd');
    expect(descriptor.subjects.slo).toMatchObject({ status: 'ready' });
    expect(Object.keys(descriptor.subjects)).not.toContain('slo-detailed');
  });

  it('ignores unknown subject ids that collide with Object prototype properties', () => {
    const wire = validWireDescriptor();
    wire.subjects = {
      ...(wire.subjects as Record<string, unknown>),
      constructor: { status: 'not_generated' },
      toString: { status: 'not_generated' },
    };

    const descriptor = parseAnalyzerV1RunDescriptor(wire);

    expect(Object.keys(descriptor.subjects)).toEqual(['slo', 'backpressure']);
  });

  it('preserves the opaque run id exactly instead of normalizing it', () => {
    const wire = validWireDescriptor();
    wire.run_id = ' opaque-run-id ';

    expect(parseAnalyzerV1RunDescriptor(wire).runId).toBe(' opaque-run-id ');
  });

  it('checks both opaque identities when a caller supplies the requested address', () => {
    expect(() =>
      parseAnalyzerV1RunDescriptor(validWireDescriptor(), {
        workspaceId: 'w_other',
        runId: 'run-other',
      }),
    ).toThrow(/workspace_id.*w_other.*w_main[\s\S]*run_id.*run-other.*20260715_1_test/);
  });

  it('preserves worker and resource identities instead of trimming them into collisions', () => {
    const wire = validWireDescriptor();
    wire.workers = [{ pool_tag: ' attn ', worker_id: ' 0 ' }];
    wire.details = { ' worker-cost-tree ': { status: 'not_generated' } };
    wire.traces = { ' perfetto ': { status: 'not_generated' } };

    const descriptor = parseAnalyzerV1RunDescriptor(wire);

    expect(descriptor.workers).toEqual([{ poolTag: ' attn ', workerId: ' 0 ' }]);
    expect(Object.keys(descriptor.details)).toEqual([' worker-cost-tree ']);
    expect(Object.keys(descriptor.traces)).toEqual([' perfetto ']);
  });

  it('rejects numeric worker identities that JavaScript cannot represent exactly', () => {
    const wire = validWireDescriptor();
    wire.workers = [{ pool_tag: 'attn', worker_id: Number.MAX_SAFE_INTEGER + 1 }];

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(
      /workers\.0\.worker_id: Number must be less than or equal to 9007199254740991/,
    );
  });

  it('rejects a ready subject that declares no readable view', () => {
    const wire = validWireDescriptor();
    wire.subjects = {
      'slo-general': { status: 'ready', schema_version: 1, views: [] },
    };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(/subjects\.slo-general/);
  });

  it('rejects a repeated view, which would declare one capability twice', () => {
    const wire = validWireDescriptor();
    wire.summary = { views: ['report', 'report'] };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(
      /summary\.views: must not repeat a view/,
    );
  });

  // The descriptor no longer carries addresses, so an address it could smuggle
  // in is protocol drift rather than a path to sanitize.
  it('rejects an address where a capability belongs', () => {
    const wire = validWireDescriptor();
    wire.summary = { views: ['report'], href: '../raw/summary.json' };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(
      /summary: Unrecognized key\(s\) in object: 'href'/,
    );
  });

  it('rejects unknown wire fields instead of silently accepting protocol drift', () => {
    const wire = validWireDescriptor();
    wire.lifecycle = { simulation: 'complete', analysis: 'complete', surprise: true };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(/lifecycle: Unrecognized key/);
  });

  it('requires an artifact revision once analysis is complete', () => {
    const wire = validWireDescriptor();
    delete wire.analysis;

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(
      /analysis: is required when lifecycle\.analysis is complete/,
    );
  });
});
