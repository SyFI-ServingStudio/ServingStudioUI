import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViz } from '../store';
import TimelineBand from './TimelineBand';

vi.mock('../application/ActiveRunProvider', () => ({
  useActiveRunData: () => ({
    subjects: {
      concurrency: {
        status: 'ready',
        payload: { t_ms: [0, 5_000, 10_000], active: [0, 8, 2], peak: 8 },
      },
    },
  }),
}));

vi.mock('./EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

beforeEach(() => {
  useViz.setState({ cursorMs: null });
});

describe('TimelineBand interaction semantics', () => {
  it('exposes aggregate and scrub actions as named native controls', async () => {
    const user = userEvent.setup();
    render(<TimelineBand />);

    const aggregate = screen.getByRole('button', { name: 'All' });
    const cursor = screen.getByRole('slider', { name: 'Simulation time cursor' });
    expect(aggregate).toHaveAttribute('aria-pressed', 'true');
    expect(cursor).toHaveAttribute('aria-valuetext', 'Aggregate, no time selected');

    await user.tab();
    expect(aggregate).toHaveFocus();
    await user.tab();
    expect(cursor).toHaveFocus();

    fireEvent.change(cursor, { target: { value: '5000' } });
    expect(useViz.getState().cursorMs).toBe(5_000);
    expect(aggregate).toHaveAttribute('aria-pressed', 'false');

    aggregate.focus();
    await user.keyboard('{Enter}');
    expect(useViz.getState().cursorMs).toBeNull();
    expect(aggregate).toHaveAttribute('aria-pressed', 'true');
  });
});
