import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViz } from '../../store';
import TimelineBand from './TimelineBand';

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRunSubject: () => ({
    subject: 'concurrency',
    status: 'ready',
    schemaVersion: 1,
    payload: { t_ms: [1, 5_000, 10_000], active: [0.25, 8.5, 2], peak: 9 },
  }),
}));

vi.mock('../../components/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

beforeEach(() => {
  useViz.setState({ cursorMs: null });
});

describe('TimelineBand interaction semantics', () => {
  it('exposes aggregate and scrub actions as named native controls', async () => {
    const user = userEvent.setup();
    render(<TimelineBand />);

    expect(screen.getByText('aggregate · peak 9')).toBeVisible();

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
    expect(screen.getByText('t = 5.00s · 8.5 active')).toBeVisible();
    expect(aggregate).toHaveAttribute('aria-pressed', 'false');

    aggregate.focus();
    await user.keyboard('{Enter}');
    expect(useViz.getState().cursorMs).toBeNull();
    expect(aggregate).toHaveAttribute('aria-pressed', 'true');
  });
});
