import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ConservationCard from './ConservationCard';

describe('ConservationCard', () => {
  it('keeps accounting values without rendering analyzer descriptions', () => {
    const { container } = render(
      <ConservationCard
        data={{
          allOk: true,
          checks: [
            {
              name: 'ffn_token_pass',
              description: 'verbose analyzer accounting formula',
              actual: 65,
              expected: 65,
              deltaPct: 0,
              status: 'ok',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('ffn_token_pass')).toBeVisible();
    expect(screen.getByRole('heading', { name: /Workload conservation/, level: 3 })).toBeVisible();
    expect(screen.getByText('65')).toBeVisible();
    expect(screen.getByText('0% vs exp')).toBeVisible();
    expect(screen.queryByText('verbose analyzer accounting formula')).not.toBeInTheDocument();
    expect(container.querySelector('[data-surface-accent-edge]')).toBeInTheDocument();
  });
});
