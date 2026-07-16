import { describe, expect, it, vi } from 'vitest';

import descriptorFixture from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/run_descriptor.json';
import params from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import runMeta from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/run_meta.json';
import sloPayload from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/slo_general_cdf.json';
import summary from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/summary.json';
import {
  HttpAnalyzerRepository,
  HttpDetailUnavailableError,
  HttpRunBindingError,
  UnknownHttpAnalyzerRunError,
} from './HttpAnalyzerRepository';

const RUN_ID = 'opaque-live-run';
const UPDATED_AT = '2026-07-15T05:11:27Z';
const REVISION = 'pipeline-generation-http-test';

interface Route {
  body: unknown;
  etag?: string;
  status?: number;
}

function absolute(path: string): string {
  return new URL(path, document.baseURI).href;
}

function protocolData() {
  const descriptor = {
    ...descriptorFixture,
    run_id: RUN_ID,
    analysis: {
      ...descriptorFixture.analysis,
      revision: REVISION,
    },
    summary: { href: 'summary' },
    model: { href: 'model', media_type: 'application/json', schema_version: 1 },
    workload: { href: 'workload', media_type: 'application/json', schema_version: 1 },
    topology: { href: 'topology', media_type: 'application/json', schema_version: 1 },
    subjects: {
      ...descriptorFixture.subjects,
      'slo-general': {
        ...descriptorFixture.subjects['slo-general'],
        report_href: `revisions/${REVISION}/reports/slo-general`,
        payload_href: `revisions/${REVISION}/payloads/slo-general`,
      },
      'kv-occupancy': {
        ...descriptorFixture.subjects['kv-occupancy'],
        report_href: `revisions/${REVISION}/reports/kv-occupancy`,
        payload_href: `revisions/${REVISION}/payloads/kv-occupancy`,
      },
      concurrency: {
        status: 'ready',
        schema_version: 1,
        payload_href: `revisions/${REVISION}/payloads/concurrency`,
      },
    },
    provenance: {
      source: 'analyzer',
      synthetic: false,
      generated_at: UPDATED_AT,
      generator_version: 'analyzer-http-test',
    },
  };
  const catalog = {
    protocol_version: 1,
    generated_at: UPDATED_AT,
    runs: [
      {
        run_id: RUN_ID,
        kind: 'simulation',
        display_name: 'nested/simulation',
        descriptor_href: `runs/${RUN_ID}/descriptor`,
        lifecycle: descriptor.lifecycle,
        updated_at: UPDATED_AT,
      },
    ],
  };
  return { catalog, descriptor };
}

function fakeAnalyzerFetch(overrides: Readonly<Record<string, Route>> = {}) {
  const { catalog, descriptor } = protocolData();
  const routes: Record<string, Route> = {
    [absolute('/api/v1/runs')]: { body: catalog, etag: '"catalog-v1"' },
    [absolute(`/api/v1/runs/${RUN_ID}/descriptor`)]: {
      body: descriptor,
      etag: '"descriptor-v1"',
    },
    [absolute(`/api/v1/runs/${RUN_ID}/summary`)]: { body: summary },
    [absolute(`/api/v1/runs/${RUN_ID}/topology`)]: {
      body: { schema_version: 1, params, run_meta: runMeta },
    },
    [absolute(`/api/v1/runs/${RUN_ID}/model`)]: {
      body: {
        schema_version: 1,
        source_path: 'model/config/qwen3_coder_480b.json',
        config: { hidden_size: 6144, num_hidden_layers: 62 },
      },
    },
    [absolute(`/api/v1/runs/${RUN_ID}/workload`)]: {
      body: {
        schema_version: 1,
        scope: 'configured_trace',
        source_paths: ['trace/aime_long.csv'],
        request_count: 2,
        arrival_basis: 'effective_open_loop',
        request_rate: 4,
        token_lengths: [16],
        input_density: [1],
        output_density: [1],
        arrival_seconds: [0],
        arrivals: [2],
        arrival_trend: [2],
        peak_to_mean: 1,
      },
    },
    [absolute(`/api/v1/runs/${RUN_ID}/revisions/${REVISION}/payloads/slo-general`)]: {
      body: sloPayload,
    },
    [absolute(`/api/v1/runs/${RUN_ID}/revisions/${REVISION}/payloads/concurrency`)]: {
      body: {
        schema_version: 1,
        meta: {
          log_dir: 'logs/test-run',
          request_count: 2,
          span_ms: 1000,
          bins: 2,
          max_points: 512,
          aggregation: 'equal-width time-weighted mean',
        },
        t_ms: [500, 1000],
        active: [1.25, 1.75],
        peak: 2,
        definitions: {
          scope: 'run',
          active: 'time-weighted mean active requests',
          t_ms: 'bucket right edge in milliseconds',
          peak: 'exact event-sweep peak',
          binning: 'equal-width bins',
        },
      },
    },
    ...overrides,
  };

  return vi.fn<typeof fetch>(async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    const route = routes[address];
    if (route === undefined) {
      return new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Artifact missing',
          status: 404,
          code: 'artifact_missing',
          detail: `No allowlisted resource at ${address}`,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      );
    }
    const requestHeaders = new Headers(init?.headers);
    if (route.etag !== undefined && requestHeaders.get('If-None-Match') === route.etag) {
      return new Response(null, { status: 304, headers: { ETag: route.etag } });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: {
        'Content-Type': 'application/json',
        ...(route.etag === undefined ? {} : { ETag: route.etag }),
      },
    });
  });
}

describe('HttpAnalyzerRepository', () => {
  it('loads catalog, core artifacts and a subject through protocol links', async () => {
    const repository = new HttpAnalyzerRepository({ fetch: fakeAnalyzerFetch() });

    await expect(repository.listRuns()).resolves.toMatchObject([
      { runId: RUN_ID, displayName: 'nested/simulation' },
    ]);
    await expect(repository.getRunDescriptor(RUN_ID)).resolves.toMatchObject({
      runId: RUN_ID,
      deployment: 'afd',
    });
    await expect(repository.getRunSummary(RUN_ID)).resolves.toMatchObject({
      requestsFinished: 5587,
      numGpus: 48,
    });
    await expect(repository.getRunTopology(RUN_ID)).resolves.toMatchObject({
      pools: [{ role: 'attn' }, { role: 'ffn' }],
    });
    await expect(repository.getRunModel(RUN_ID)).resolves.toMatchObject({
      sourcePath: 'model/config/qwen3_coder_480b.json',
      config: { hidden_size: 6144 },
    });
    await expect(repository.getRunWorkload(RUN_ID)).resolves.toMatchObject({
      requestCount: 2,
      sourcePaths: ['trace/aime_long.csv'],
    });
    await expect(repository.getSubject(RUN_ID, 'slo')).resolves.toMatchObject({
      subject: 'slo',
      status: 'ready',
      schemaVersion: 1,
    });
    await expect(repository.getSubject(RUN_ID, 'concurrency')).resolves.toEqual({
      subject: 'concurrency',
      status: 'ready',
      schemaVersion: 1,
      payload: { t_ms: [500, 1000], active: [1.25, 1.75], peak: 2 },
    });
  });

  it('keeps a missing optional payload local to that subject', async () => {
    const repository = new HttpAnalyzerRepository({ fetch: fakeAnalyzerFetch() });
    await repository.listRuns();
    await repository.getRunDescriptor(RUN_ID);

    await expect(repository.getSubject(RUN_ID, 'kv')).resolves.toMatchObject({
      subject: 'kv',
      status: 'failed',
      code: 'artifact_missing',
    });
    await expect(repository.getSubject(RUN_ID, 'slo')).resolves.toMatchObject({
      subject: 'slo',
      status: 'ready',
    });
  });

  it('keeps a stale generation conflict local to that subject', async () => {
    const stalePayload = absolute(
      `/api/v1/runs/${RUN_ID}/revisions/${REVISION}/payloads/slo-general`,
    );
    const repository = new HttpAnalyzerRepository({
      fetch: fakeAnalyzerFetch({
        [stalePayload]: {
          status: 409,
          body: {
            type: 'about:blank',
            title: 'Artifact generation changed',
            status: 409,
            code: 'artifact_generation_changed',
            detail: 'The requested analysis revision is no longer current.',
          },
        },
      }),
    });

    await repository.listRuns();
    await repository.getRunDescriptor(RUN_ID);
    await expect(repository.getSubject(RUN_ID, 'slo')).resolves.toMatchObject({
      subject: 'slo',
      status: 'failed',
      code: 'artifact_generation_changed',
    });
  });

  it('reuses cached catalog and descriptor bodies after conditional 304 responses', async () => {
    const fetch = fakeAnalyzerFetch();
    const repository = new HttpAnalyzerRepository({ fetch });

    const first = await repository.listRuns();
    const second = await repository.listRuns();
    const firstDescriptor = await repository.getRunDescriptor(RUN_ID);
    const secondDescriptor = await repository.getRunDescriptor(RUN_ID);

    expect(second).toEqual(first);
    expect(secondDescriptor).toEqual(firstDescriptor);
    const catalogCalls = fetch.mock.calls.filter(
      ([input]) => String(input) === absolute('/api/v1/runs'),
    );
    expect(catalogCalls).toHaveLength(2);
    expect(new Headers(catalogCalls[1]?.[1]?.headers).get('If-None-Match')).toBe('"catalog-v1"');
    const descriptorCalls = fetch.mock.calls.filter(
      ([input]) => String(input) === absolute(`/api/v1/runs/${RUN_ID}/descriptor`),
    );
    expect(descriptorCalls).toHaveLength(2);
    expect(new Headers(descriptorCalls[1]?.[1]?.headers).get('If-None-Match')).toBe(
      '"descriptor-v1"',
    );
  });

  it('rejects unknown ids and descriptor identity substitution', async () => {
    const repository = new HttpAnalyzerRepository({ fetch: fakeAnalyzerFetch() });
    await repository.listRuns();
    await expect(repository.getRunDescriptor('not-in-catalog')).rejects.toBeInstanceOf(
      UnknownHttpAnalyzerRunError,
    );

    const { descriptor } = protocolData();
    const substituted = new HttpAnalyzerRepository({
      fetch: fakeAnalyzerFetch({
        [absolute(`/api/v1/runs/${RUN_ID}/descriptor`)]: {
          body: { ...descriptor, run_id: 'different-run' },
        },
      }),
    });
    await substituted.listRuns();
    await expect(substituted.getRunDescriptor(RUN_ID)).rejects.toBeInstanceOf(HttpRunBindingError);
  });

  it('does not pretend an undeclared detail protocol is implemented', async () => {
    const repository = new HttpAnalyzerRepository({ fetch: fakeAnalyzerFetch() });
    await repository.listRuns();
    await repository.getRunDescriptor(RUN_ID);

    await expect(
      repository.getWorkerTimeline(RUN_ID, { poolTag: 'attn', workerId: '0' }),
    ).rejects.toBeInstanceOf(HttpDetailUnavailableError);
    await expect(
      repository.getWorkerCostTree(RUN_ID, { poolTag: 'attn', workerId: '0' }),
    ).rejects.toMatchObject({
      detailName: 'worker-cost-tree',
      status: 'not_generated',
    });
  });

  it('requires a same-origin API root', () => {
    expect(
      () => new HttpAnalyzerRepository({ apiBaseUrl: 'https://different.example/api/v1/' }),
    ).toThrow(/same-origin/);
  });
});
