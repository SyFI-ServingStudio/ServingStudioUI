import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AlignmentWorkloadSeries } from '../../domain/alignment';
import WholeRunCard from './WholeRunCard';

vi.mock('../../components/EChart', () => ({
  default: ({ ariaLabel }: { readonly ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel} />
  ),
}));

const workload: AlignmentWorkloadSeries = {
  available: true,
  definitions: {},
  measured: {
    iterationId: [10, 11],
    timeMs: [0, 20],
    iterationCycleMs: [20, null],
    prefillTokens: [4, 0],
    decodeBatchSize: [0, 1],
    scheduledKvTokens: [4, 5],
  },
  simulated: {
    iterationId: [20, 21],
    timeMs: [0, 24],
    iterationCycleMs: [24, null],
    prefillTokens: [4, 0],
    decodeBatchSize: [0, 1],
    scheduledKvTokens: [4, 5],
  },
};

describe('WholeRunCard scheduler axis', () => {
  it('switches every scheduler figure from elapsed time to original iteration IDs', async () => {
    const user = userEvent.setup();
    render(<WholeRunCard e2e={null} workload={workload} />);

    expect(screen.getByRole('button', { name: 'Elapsed time' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('img', { name: /decode batch by elapsed time/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Iteration ID' }));

    expect(screen.getByRole('button', { name: 'Iteration ID' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('img', { name: /decode batch by iteration ID/ })).toBeInTheDocument();
  });
});
