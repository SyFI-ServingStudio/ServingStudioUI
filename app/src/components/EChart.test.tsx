import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ECHARTS_THEME_NAME } from '../charts/platform';
import EChart from './EChart';

vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ theme }: { theme?: string }) => <div data-testid="echarts-core" data-theme={theme} />,
}));

describe('EChart', () => {
  it('applies the single registered chart theme to every instance', () => {
    render(<EChart option={{}} ariaLabel="Test chart" />);

    expect(screen.getByRole('img', { name: 'Test chart' })).toBeInTheDocument();
    expect(screen.getByTestId('echarts-core')).toHaveAttribute('data-theme', ECHARTS_THEME_NAME);
  });
});
