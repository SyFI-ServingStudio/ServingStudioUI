import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useChartFocusDialog, type ChartFocusPayload } from '../../components/ChartFocusContext';
import { ChartFocusProvider } from '../../components/ChartFocusProvider';
import { MetricCard } from './wholeRunCards';

vi.mock('../../components/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

describe('MetricCard expanded view', () => {
  it('opens scheduler and E2E figures full-screen with navigation controls', async () => {
    const user = userEvent.setup();
    let observed: ChartFocusPayload | null = null;
    function FocusObserver() {
      const { focus } = useChartFocusDialog();
      observed = focus;
      return null;
    }

    render(
      <ChartFocusProvider>
        <MetricCard
          title="decode batch"
          meta="scheduler shape"
          stats={[]}
          option={{ grid: { left: 40, bottom: 30 }, series: [] }}
          figureLabel="Measured and modelled scheduler iterations"
        />
        <FocusObserver />
      </ChartFocusProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Expand decode batch' }));

    expect(observed).toMatchObject({
      title: 'decode batch',
      fullScreen: true,
      interactionHint: expect.stringContaining('Wheel to zoom'),
      option: {
        grid: { left: 40, bottom: 72 },
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
      },
    });
  });
});
