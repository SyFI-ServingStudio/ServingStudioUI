import { describe, expect, it } from 'vitest';

import params from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import runMeta from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/run_meta.json';
import { parseAnalyzerV1TopologyArtifact } from './topologyArtifact';

describe('parseAnalyzerV1TopologyArtifact', () => {
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
