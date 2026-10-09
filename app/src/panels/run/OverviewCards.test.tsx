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
        workersPerReplica: 1,
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
        workersPerReplica: 1,
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
        runName="Qwen run"
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

  it('reads DeepSeek expert counts and leaves an unnamed parallelism unknown', () => {
    const fixed: RunTopology = {
      deployment: 'unified',
      gpus: 4,
      pools: [
        {
          tag: 'main',
          placement: 'least-queued',
          group: {
            gpu: 'NVIDIA B200',
            archType: 'deepseek_v41_vllm',
            workerType: 'chunked_prefill',
            replicas: 1,
            workersPerReplica: 1,
            gpusPerReplica: 4,
            params: { model_config: 'model/config/deepseek_v41_flash.json' },
            workers: [{ id: '0', gpus: [0, 1, 2, 3] }],
          },
        },
      ],
    };
    const deepseek: RunModel = {
      sourcePath: 'model/config/deepseek_v41_flash.json',
      parameters: { total: 748_500_000_000, active: 16_800_000_000 },
      config: { n_routed_experts: 384, num_experts_per_tok: 6 },
    };
    render(
      <OverviewCards
        runName={undefined}
        topology={fixed}
        model={deepseek}
        workload={{ status: 'not_generated', reason: 'analysis has not run' }}
      />,
    );
    expect(screen.getByText('384 / 6')).toBeVisible();
    expect(screen.getByText(/^mixture of experts/)).toBeVisible();
    for (const label of [
      'Tensor parallel',
      'Expert parallel',
      'Data parallel',
      'Pipeline parallel',
    ]) {
      expect(screen.getByText(label).previousSibling).toHaveTextContent('n/a');
    }
  });

  it('names a pipeline-parallel run, counts its stages as workers, and shows its PP degree', () => {
    // One replica of a five-stage pipeline, as the pp5 run declares it: five
    // workers ran, not one.
    const pipeline: RunTopology = {
      deployment: 'pp',
      gpus: 5,
      pools: [
        {
          tag: 'stage',
          placement: 'least-queued',
          group: {
            gpu: 'NVIDIA B200',
            archType: 'glm53_flash_vllm_nvfp4_pp_kda_dsa_moe',
            workerType: 'pipeline_chunked_prefill',
            replicas: 1,
            workersPerReplica: 5,
            gpusPerReplica: 5,
            params: { model_config: 'model/config/glm53_flash_nvfp4.json', pp_size: 5 },
            workers: [0, 1, 2, 3, 4].map((id) => ({ id: String(id), gpus: [id] })),
          },
        },
      ],
    };
    render(
      <OverviewCards
        runName={undefined}
        topology={pipeline}
        model={undefined}
        workload={{ status: 'not_generated', reason: 'analysis has not run' }}
      />,
    );
    expect(screen.getByText('Pipeline-parallel deployment')).toBeVisible();
    expect(screen.getByText('Workers').previousSibling).toHaveTextContent('5');
    expect(screen.getByText('GPUs').previousSibling).toHaveTextContent('5');
    // The degree comes from the arch's pp_size, the way TP and EP do.
    expect(screen.getByText('Pipeline parallel').previousSibling).toHaveTextContent('5');
  });

  it('keeps the trace card shape when workload generation is absent', () => {
    render(
      <OverviewCards
        runName="Qwen run"
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
