import { describe, expect, it } from 'vitest';

import { CHART_THEME, richTextTooltip, safeChartText } from './platform';

const ATTACK = '<img src=x onerror=alert(1)>{owned|payload}&';

describe('chart platform', () => {
  it('neutralizes HTML and zrender rich-text grammar in external labels', () => {
    const safe = safeChartText(ATTACK);

    expect(safe).not.toMatch(/[<>{}&]/);
    expect(safe).toContain('＜img');
    expect(safe).toContain('｛owned|payload｝');
  });

  it('forces canvas rich-text tooltips', () => {
    expect(richTextTooltip(CHART_THEME, 'axis').renderMode).toBe('richText');
  });
});
