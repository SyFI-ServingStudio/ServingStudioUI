import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ConservationCard from './ConservationCard';

describe('ConservationCard', () => {
  it('shows measured accounting and imbalance status', () => {
    render(
      <ConservationCard
        data={{
          allOk: false,
          checks: [
            {
              name: 'ffn_token_pass',
              description: 'verbose analyzer accounting formula',
              actual: 65,
              expected: 50,
              deltaPct: 30,
              status: 'fail',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('ffn_token_pass')).toBeVisible();
    expect(screen.getByRole('heading', { name: /Workload conservation/, level: 3 })).toBeVisible();
    expect(screen.getByText('65')).toBeVisible();
    expect(screen.getByText('+30% vs exp')).toBeVisible();
    expect(screen.getByText('FAIL')).toBeVisible();
    expect(screen.getByText('imbalance flagged')).toBeVisible();
  });
});
