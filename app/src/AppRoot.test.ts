import { describe, expect, it } from 'vitest';

import { appViewFromHash } from './application/appRoute';

describe('appViewFromHash', () => {
  it('keeps Page 0 as the default and recognizes integrated surfaces', () => {
    expect(appViewFromHash('')).toBe('entry');
    expect(appViewFromHash('#/')).toBe('entry');
    expect(appViewFromHash('#/agent')).toBe('agent');
    expect(appViewFromHash('#/aggregate?experiment=s_test')).toBe('aggregate');
    expect(appViewFromHash('#/run')).toBe('run');
  });
});
