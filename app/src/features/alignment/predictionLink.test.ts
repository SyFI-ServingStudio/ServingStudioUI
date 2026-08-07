import { describe, expect, it } from 'vitest';

import { predictionHref } from './predictionLink';

describe('predictionHref', () => {
  it('addresses the prediction route by workspace and resource id', () => {
    expect(predictionHref('w_main', 'p_45cdb1ba')).toBe(
      '#/prediction?workspace=w_main&prediction=p_45cdb1ba&optimalityMode=unlocked',
    );
  });

  it('escapes identities rather than pasting them into the query', () => {
    expect(predictionHref('w main&x', 'p_a b')).toBe(
      '#/prediction?workspace=w+main%26x&prediction=p_a+b&optimalityMode=unlocked',
    );
  });
});
