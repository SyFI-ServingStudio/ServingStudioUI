import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useActiveRun,
  useActiveRunModel,
  useActiveRunWorkload,
} from '../../application/ActiveRunProvider';
import { assembleActiveRunCore } from '../../application/loadActiveRun';
import { makeTestDescriptor, makeTestTopology } from '../../test/analyzerRepositoryFixture';
import RunOverviewRow from './RunOverviewRow';

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRun: vi.fn(),
  useActiveRunModel: vi.fn(),
  useActiveRunWorkload: vi.fn(),
}));

vi.mock('../../components/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const run = assembleActiveRunCore(
  makeTestDescriptor(),
  { totalTokS: 10, numGpus: 2, requestsFinished: 5 },
  makeTestTopology(),
).run;

beforeEach(() => {
  vi.mocked(useActiveRun).mockReturnValue(run);
  vi.mocked(useActiveRunModel).mockReturnValue({ status: 'not_generated' });
  vi.mocked(useActiveRunWorkload).mockReturnValue({ status: 'not_generated' });
});

describe('RunOverviewRow resources', () => {
  it('keeps missing optional resources explicit', () => {
    render(<RunOverviewRow />);

    expect(screen.getByText('Trace distribution not generated')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders model config and both bounded workload charts', () => {
    vi.mocked(useActiveRunModel).mockReturnValue({
      status: 'ready',
      resource: {
        schemaVersion: 1,
        sourcePath: 'model/config/test.json',
        config: {
          hidden_size: 6144,
          num_hidden_layers: 62,
          num_attention_heads: 96,
          num_key_value_heads: 8,
          max_position_embeddings: 262144,
          num_experts: 160,
          num_experts_per_tok: 8,
        },
      },
    });
    vi.mocked(useActiveRunWorkload).mockReturnValue({
      status: 'ready',
      resource: {
        schemaVersion: 1,
        scope: 'configured_trace',
        sourcePaths: ['trace/test.csv'],
        requestCount: 2,
        averageInputTokens: 24,
        averageOutputTokens: 48.5,
        arrivalBasis: 'effective_open_loop',
        requestRate: 4,
        tokenLengths: [16, 32],
        inputDensity: [0.5, 1],
        outputDensity: [1, 0.5],
        arrivalSeconds: [0, 0.5],
        arrivals: [1, 1],
        arrivalTrend: [1, 1],
        peakToMean: 1.25,
      },
    });

    render(<RunOverviewRow />);

    expect(screen.getByText('6,144')).toBeVisible();
    expect(screen.getByText('160 / 8')).toBeVisible();
    expect(screen.getByText('24')).toBeVisible();
    expect(screen.getByText('48.5')).toBeVisible();
    expect(screen.getByText('test.csv')).toBeVisible();
    expect(screen.getByText('Avg input tokens')).toBeVisible();
    expect(screen.getByText('Avg output tokens')).toBeVisible();
    expect(screen.getByText('Trace file')).toBeVisible();
    expect(screen.queryByText(/wall-clock/)).not.toBeInTheDocument();
    expect(screen.queryByText(/peak \/ mean/)).not.toBeInTheDocument();
    expect(screen.queryByText(/source trace/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Configured trace input and output token length distributions',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Configured trace effective request rate over time' }),
    ).toBeVisible();
  });
});
