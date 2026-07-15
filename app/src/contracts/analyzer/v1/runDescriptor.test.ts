import { describe, expect, it } from 'vitest';

import { parseAnalyzerV1RunDescriptor } from './runDescriptor';

function validWireDescriptor(): Record<string, unknown> {
  return {
    protocol_version: 1,
    run_id: '20260715_1_test',
    kind: 'simulation',
    display_name: 'Test run',
    model_name: 'model/test.json',
    deployment: 'afd',
    lifecycle: { simulation: 'complete', analysis: 'complete' },
    summary: { href: 'reports/summary.json', media_type: 'application/json' },
    topology: { href: 'reports/topology.json' },
    workers: [
      { pool_tag: 'attn', worker_id: 0 },
      { pool_tag: 'ffn', worker_id: 0 },
    ],
    subjects: {
      'slo-general': {
        status: 'ready',
        schema_version: 1,
        report_href: 'reports/slo.json',
        payload_href: 'payloads/slo.json',
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
  it('maps the strict snake-case wire contract without collapsing worker identity', () => {
    const descriptor = parseAnalyzerV1RunDescriptor(validWireDescriptor());

    expect(descriptor).toMatchObject({
      protocolVersion: 1,
      runId: '20260715_1_test',
      modelName: 'model/test.json',
      deployment: 'afd',
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      workers: [
        { poolTag: 'attn', workerId: '0' },
        { poolTag: 'ffn', workerId: '0' },
      ],
    });
    expect(descriptor.subjects.slo).toMatchObject({ status: 'ready', schemaVersion: 1 });
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

  it('reports the precise path when a required deployment field is missing', () => {
    const wire = validWireDescriptor();
    delete wire.deployment;

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(/deployment: Required/);
  });

  it('rejects a ready subject that has no addressable artifact', () => {
    const wire = validWireDescriptor();
    wire.subjects = {
      'slo-general': { status: 'ready', schema_version: 1 },
    };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(
      /subjects\.slo-general: ready subject requires report_href or payload_href/,
    );
  });

  it.each([
    'https://example.test/summary.json',
    '/api/v1/summary.json',
    '../raw/summary.json',
    'reports/%2e%2e/raw/summary.json',
    'reports/%252e%252e/raw/summary.json',
  ])('rejects unsafe artifact href %s', (href) => {
    const wire = validWireDescriptor();
    wire.summary = { href };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(/summary\.href:/);
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
