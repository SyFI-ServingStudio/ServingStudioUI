import { describe, expect, it } from 'vitest';

import paramsJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import { parseAnalyzerV1Params } from './params';

describe('parseAnalyzerV1Params', () => {
  it('rejects pool roles that disagree with the deployment contract', () => {
    const params = structuredClone(paramsJson) as Record<string, unknown>;
    const pools = params.pools as Record<string, unknown>;
    pools.extra = pools.ffn;

    expect(() => parseAnalyzerV1Params(params)).toThrow(/pools: Unrecognized key.*extra/);
  });

  it('rejects non-scalar provider parameters', () => {
    const params = structuredClone(paramsJson) as typeof paramsJson;
    (params.pools.attn.groups[0].arch as Record<string, unknown>).future_shape = [1, 2];

    expect(() => parseAnalyzerV1Params(params)).toThrow(/future_shape/);
  });
});
