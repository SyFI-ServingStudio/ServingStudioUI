import { describe, expect, it } from 'vitest';

import { predictionHref } from './predictionLink';

describe('predictionHref', () => {
  it('escapes identities rather than pasting them into the query', () => {
    expect(predictionHref('w main&x', 'p_a b')).toBe(
      '#/prediction?workspace=w+main%26x&prediction=p_a+b&optimalityMode=unlocked',
    );
  });
});
