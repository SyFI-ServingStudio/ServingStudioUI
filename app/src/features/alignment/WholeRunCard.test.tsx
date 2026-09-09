import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChartFocusProvider } from '../../components/ChartFocusProvider';
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
    render(
      <ChartFocusProvider>
        <WholeRunCard e2e={null} workload={workload} />
      </ChartFocusProvider>,
    );

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

it('shows the current Analyzer definition and leaves absent definitions empty', async () => {
  const user = userEvent.setup();
  const view = (definitions: AlignmentWorkloadSeries['definitions']) => (
    <ChartFocusProvider>
      <WholeRunCard e2e={null} workload={{ ...workload, definitions }} />
    </ChartFocusProvider>
  );
  const { rerender } = render(view({ decode_batch_size: 'Requests decoded in this capture.' }));
  const heading = screen.getByText('decode batch', { selector: 'h3', exact: true });
  await user.hover(heading);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Requests decoded in this capture.');

  rerender(view({ decode_batch_size: 'Updated Analyzer definition for another capture.' }));
  expect(screen.getByRole('tooltip')).toHaveTextContent(
    'Updated Analyzer definition for another capture.',
  );
  expect(screen.queryByText('Requests decoded in this capture.')).not.toBeInTheDocument();

  rerender(view({}));
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'decode batch' })).toBeVisible();
});
