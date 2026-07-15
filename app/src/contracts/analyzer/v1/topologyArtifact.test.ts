import { describe, expect, it } from 'vitest';

import params from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import runMeta from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/run_meta.json';
import { parseAnalyzerV1TopologyArtifact } from './topologyArtifact';

describe('parseAnalyzerV1TopologyArtifact', () => {
  it('unwraps the versioned HTTP resource through the existing topology adapter', () => {
    const topology = parseAnalyzerV1TopologyArtifact(
      { schema_version: 1, params, run_meta: runMeta },
      'afd',
    );

    expect(
      topology.pools.map((pool) => [
        pool.role,
        pool.groups.reduce((count, group) => count + group.workers.length, 0),
      ]),
    ).toEqual([
      ['attn', 8],
      ['ffn', 2],
    ]);
  });

  it('rejects envelope drift before interpreting simulator metadata', () => {
    expect(() =>
      parseAnalyzerV1TopologyArtifact({ schema_version: 2, params, run_meta: runMeta }, 'afd'),
    ).toThrow(/schema_version/);
    expect(() =>
      parseAnalyzerV1TopologyArtifact(
        { schema_version: 1, params, run_meta: runMeta, extra: true },
        'afd',
      ),
    ).toThrow(/Unrecognized key/);
  });
});
