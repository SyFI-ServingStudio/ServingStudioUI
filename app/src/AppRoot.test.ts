import { describe, expect, it } from 'vitest';

import { appViewFromHash, predictionIdFromHash } from './application/appRoute';

describe('appViewFromHash', () => {
  it('keeps Page 0 as the default and recognizes integrated surfaces', () => {
    expect(appViewFromHash('')).toBe('entry');
    expect(appViewFromHash('#/')).toBe('entry');
    expect(appViewFromHash('#/agent')).toBe('agent');
    expect(appViewFromHash('#/aggregate?experiment=s_test')).toBe('aggregate');
    expect(appViewFromHash('#/prediction?prediction=p_abc123')).toBe('prediction');
    expect(appViewFromHash('#/run')).toBe('run');
  });

  it('reads only valid first-class prediction identities', () => {
    expect(predictionIdFromHash('#/prediction?prediction=p_abc123')).toBe('p_abc123');
    expect(predictionIdFromHash('#/prediction?prediction=r_abc123')).toBeNull();
    expect(predictionIdFromHash('#/run?prediction=p_abc123')).toBeNull();
  });
});
