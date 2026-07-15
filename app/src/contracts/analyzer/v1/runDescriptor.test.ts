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
      slo: {
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
    traces: {
      perfetto: { status: 'not_generated', reason: 'No trace was requested.' },
    },
    provenance: {
      source: 'analyzer',
      synthetic: false,
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
  });

  it('reports the precise path when a required deployment field is missing', () => {
    const wire = validWireDescriptor();
    delete wire.deployment;

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(/deployment: Required/);
  });

  it('rejects a ready subject that has no addressable artifact', () => {
    const wire = validWireDescriptor();
    wire.subjects = {
      slo: { status: 'ready', schema_version: 1 },
    };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(
      /subjects\.slo: ready subject requires report_href or payload_href/,
    );
  });

  it('rejects unknown wire fields instead of silently accepting protocol drift', () => {
    const wire = validWireDescriptor();
    wire.lifecycle = { simulation: 'complete', analysis: 'complete', surprise: true };

    expect(() => parseAnalyzerV1RunDescriptor(wire)).toThrow(/lifecycle: Unrecognized key/);
  });
});
