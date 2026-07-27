import { render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ECHARTS_THEME_NAME } from '../charts/platform';
import EChart from './EChart';

vi.mock('echarts-for-react/lib/core', () => ({
  default: forwardRef(function EChartsCoreMock(
    { theme, opts }: { theme?: string; opts?: { renderer?: string } },
    _ref,
  ) {
    return <div data-testid="echarts-core" data-theme={theme} data-renderer={opts?.renderer} />;
  }),
}));

describe('EChart', () => {
  it('applies the shared theme and SVG renderer to every instance', () => {
    render(<EChart option={{}} ariaLabel="Test chart" />);

    expect(screen.getByRole('img', { name: 'Test chart' })).toBeInTheDocument();
    expect(screen.getByTestId('echarts-core')).toHaveAttribute('data-theme', ECHARTS_THEME_NAME);
    expect(screen.getByTestId('echarts-core')).toHaveAttribute('data-renderer', 'svg');
  });
});
