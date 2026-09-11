import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RunModel, RunTopology, RunWorkload } from '../../artifacts';
import { OverviewCards } from './OverviewCards';

vi.mock('../../ui/controls/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const topology: RunTopology = {
  deployment: 'afd',
  gpus: 4,
  pools: [
    {
      tag: 'attention',
      placement: 'least-queued',
      group: {
        gpu: 'NVIDIA H200',
        archType: 'qwen3_moe_attention_dp',
        workerType: 'barebone',
        replicas: 2,
        gpusPerReplica: 1,
        params: { model_config: 'model/config/qwen3_235b.json', attn_tp_size: 2 },
        workers: [
          { id: '0', gpus: [0] },
          { id: '1', gpus: [1] },
        ],
      },
    },
    {
      tag: 'ffn',
      placement: 'round-robin',
      group: {
        gpu: 'NVIDIA H200',
        archType: 'qwen3_moe_ffn_ep',
        workerType: 'barebone',
        replicas: 2,
        gpusPerReplica: 1,
        params: { model_config: 'model/config/qwen3_235b.json', ep_size: 4 },
        workers: [
          { id: '0', gpus: [2] },
          { id: '1', gpus: [3] },
        ],
      },
    },
  ],
};

const model: RunModel = {
  sourcePath: 'model/config/qwen3_235b.json',
  parameters: { total: 235_092_836_352, active: 22_216_000_000 },
  config: {
    hidden_size: 6144,
    num_hidden_layers: 62,
    num_attention_heads: 96,
    num_key_value_heads: 8,
    max_position_embeddings: 262144,
    num_experts: 160,
    num_experts_per_tok: 8,
  },
};

const workload: RunWorkload = {
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
};

describe('OverviewCards', () => {
  it('reproduces the existing three cards and both workload charts', () => {
    render(
      <OverviewCards
        runId="Qwen run"
        topology={topology}
        model={model}
        workload={{ status: 'ready', value: workload, schemaVersion: 1, revision: 'r1' }}
      />,
    );

    expect(screen.getByText('Model overview')).toBeVisible();
    expect(screen.getByText('Simulation overview')).toBeVisible();
    expect(screen.getByText('Trace overview')).toBeVisible();
    expect(screen.getByText('AFD deployment')).toBeVisible();
    expect(screen.getByText('235.1B')).toBeVisible();
    expect(screen.getByText('160 / 8')).toBeVisible();
    expect(screen.getByText('48.5')).toBeVisible();
    expect(screen.getByText('test.csv')).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Configured trace input and output token length distributions',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Configured trace effective request rate over time' }),
    ).toBeVisible();
  });

  it('keeps the trace card shape when workload generation is absent', () => {
    render(
      <OverviewCards
        runId="Qwen run"
        topology={topology}
        model={undefined}
        workload={{ status: 'not_generated', reason: 'analysis has not run' }}
      />,
    );
    expect(screen.getByText('model/config/qwen3_235b.json')).toBeVisible();
    expect(screen.getByText('Trace distribution not generated')).toBeVisible();
    expect(screen.getByText('analysis has not run')).toBeVisible();
  });
});
