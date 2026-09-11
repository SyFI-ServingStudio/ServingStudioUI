import { describe, expect, it } from 'vitest';

import { safeChartText } from './platform';

const ATTACK = '<img src=x onerror=alert(1)>{owned|payload}&';

describe('chart platform', () => {
  it('neutralizes HTML and zrender rich-text grammar in external labels', () => {
    const safe = safeChartText(ATTACK);

    expect(safe).not.toMatch(/[<>{}&]/);
    expect(safe).toContain('＜img');
    expect(safe).toContain('｛owned|payload｝');
  });
});
