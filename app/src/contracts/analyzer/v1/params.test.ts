import { describe, expect, it } from 'vitest';

import paramsJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import { parseAnalyzerV1Params } from './params';

describe('parseAnalyzerV1Params', () => {
  it('validates the real 20260715 AFD params and preserves selector scalars', () => {
    const params = parseAnalyzerV1Params(paramsJson);

    expect(params.deployment).toBe('afd');
    if (params.deployment !== 'afd') throw new Error('expected AFD params');
    expect(params.pools.attn.groups[0].arch).toMatchObject({
      type: 'qwen3_attn_tp',
      model_config: 'model/config/qwen3_coder_480b.json',
      attn_tp_size: 4,
      fp8: true,
    });
    expect(params.pools.ffn.groups[0].worker.type).toBe('disagg_ffn');
  });

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
