import { describe, expect, it } from 'vitest';

import { predictionIdFromHash } from './application/appRoute';

describe('appViewFromHash', () => {
  it('reads only valid first-class prediction identities', () => {
    expect(predictionIdFromHash('#/prediction?prediction=p_abc123')).toBe('p_abc123');
    expect(predictionIdFromHash('#/prediction?prediction=r_abc123')).toBeNull();
    expect(predictionIdFromHash('#/run?prediction=p_abc123')).toBeNull();
  });
});
