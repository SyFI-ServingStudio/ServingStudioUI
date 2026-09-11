import { describe, expect, it } from 'vitest';

import type { RunModel, RunTopology, TopologyGroup } from '../../artifacts';
import { EMPTY_FOCUS, type Focus, type Segment } from '../../location';
import { archChips, systemMap } from './map';

function group(over: Partial<TopologyGroup> = {}): TopologyGroup {
  return {
    gpu: 'NVIDIA H200',
    archType: 'llama3_dense',
    workerType: 'barebone',
    replicas: 2,
    gpusPerReplica: 1,
    params: {},
    workers: [
      { id: '0', gpus: [0] },
      { id: '1', gpus: [1] },
    ],
    ...over,
  };
}

const TOPOLOGY: RunTopology = {
  gpus: 3,
  deployment: 'pd',
  pools: [
    { tag: 'prefill', placement: 'least-queued', group: group() },
    {
      tag: 'decode',
      placement: 'round-robin',
      group: group({ replicas: 1, workers: [{ id: '0', gpus: [2] }] }),
    },
  ],
};

function model(config: Record<string, unknown>): RunModel {
  return { sourcePath: 'model/config/x.json', config, parameters: undefined };
}

function at(path: Segment[]): Focus {
  return { ...EMPTY_FOCUS, path };
}

describe('systemMap', () => {
  it('says the whole run is selected when the address names no pool', () => {
    const map = systemMap(TOPOLOGY, undefined, at([]));
    expect(map.cluster).toEqual({ pools: 2, gpus: 3, deployment: 'pd', selected: true });
    expect(map.pools.every((pool) => !pool.selected)).toBe(true);
  });

  it('keeps the pool lit while the reader is inside one of its workers', () => {
    // The address is a path, and every step of it is where the reader is. A map
    // that lit only the worker would leave them unable to see which pool they
    // had descended through — which matters because worker ids repeat across
    // pools, so "worker 0" alone does not say where they are.
    const map = systemMap(
      TOPOLOGY,
      undefined,
      at([
        { at: 'pool', role: 'prefill' },
        { at: 'worker', id: '1' },
      ]),
    );
    expect(map.cluster.selected).toBe(false);
    expect(map.pools.find((pool) => pool.tag === 'prefill')?.selected).toBe(true);
    expect(map.pools.find((pool) => pool.tag === 'decode')?.selected).toBe(false);
  });

  it('does not light the same worker id in another pool', () => {
    // Both pools have a worker `0`. Matching on the id alone would light two.
    const map = systemMap(
      TOPOLOGY,
      undefined,
      at([
        { at: 'pool', role: 'decode' },
        { at: 'worker', id: '0' },
      ]),
    );
    const lit = map.pools.flatMap((pool) =>
      pool.workers.filter((worker) => worker.selected).map((worker) => `${pool.tag}/${worker.id}`),
    );
    expect(lit).toEqual(['decode/0']);
  });

  it('counts a pool’s GPUs across its replicas', () => {
    const wide = systemMap(
      {
        gpus: 8,
        deployment: 'unified',
        pools: [{ tag: 'main', placement: 'p', group: group({ gpusPerReplica: 4 }) }],
      },
      undefined,
      at([]),
    );
    expect(wide.pools[0].gpus).toBe(8);
  });
});

describe('archChips', () => {
  // The vocabulary is the simulator's, so these fixtures are the field names
  // `IterArchSel` actually declares. A test written against invented names
  // would pass while the card stayed blank on every real run.
  it('shows the run’s layer count over the checkpoint’s', () => {
    // `num_layers` is documented as "omit to use the model config's value", so
    // when it is set it is what ran — and a run cut to 8 layers for a quick
    // measurement must not display the checkpoint's 32.
    expect(
      archChips(group({ params: { num_layers: 8 } }), model({ num_hidden_layers: 32 })),
    ).toContain('L=8');
  });

  it('falls back to the checkpoint when the run overrode nothing', () => {
    expect(archChips(group(), model({ num_hidden_layers: 32 }))).toContain('L=32');
  });

  it('counts the layers that were simulated, not the ones they stand for', () => {
    // The simulator resolves `sim_num_layers ?? num_layers`, so 4 layers ran and
    // the other 90 were scaled from them. Reporting 94 would name a measurement
    // nobody took — and nothing else on the page says the run was truncated.
    expect(archChips(group({ params: { num_layers: 94, sim_num_layers: 4 } }), undefined)).toEqual([
      'L=4 of 94',
    ]);
  });

  it('takes the depth being stood for from the checkpoint when the run set none', () => {
    // `sim_num_layers` alone still truncates, and the model file supplies what
    // it is a truncation of.
    expect(
      archChips(group({ params: { sim_num_layers: 2 } }), model({ num_hidden_layers: 32 })),
    ).toContain('L=2 of 32');
  });

  it('says one number when the whole model ran', () => {
    // Some presets set `sim_num_layers` to the full depth. That is not a
    // truncation, and "L=32 of 32" would read as though something were missing.
    expect(archChips(group({ params: { num_layers: 32, sim_num_layers: 32 } }), undefined)).toEqual(
      ['L=32'],
    );
  });

  it('shows whichever split the run’s architecture family uses', () => {
    // A dense selector has one `tp_size`; the disaggregated ones split it into
    // two numbers that are genuinely different. A formatter that knew only the
    // first would show a 144-GPU deployment with no sign of how it was split.
    expect(archChips(group({ params: { tp_size: 4 } }), undefined)).toContain('TP=4');
    expect(archChips(group({ params: { attn_tp_size: 4, ffn_tp_size: 8 } }), undefined)).toEqual([
      'attn TP=4',
      'FFN TP=8',
    ]);
  });

  it('shows the expert-parallel shape of a disaggregated MoE pool', () => {
    // Straight from `presets/afd_8attn_2ffn_144g_fp8.json`, the ffn pool.
    expect(
      archChips(
        group({
          params: {
            model_config: 'model/config/qwen3_235b_fp8.json',
            attn_tp_size: 4,
            ep_size: 8,
            nvl_num_gpu: 8,
            fp8: true,
          },
        }),
        undefined,
      ),
    ).toEqual(['attn TP=4', 'EP=8', 'NVL=8']);
  });

  it('pairs the expert count with what runs per token', () => {
    expect(archChips(group(), model({ num_experts: 128, num_experts_per_tok: 8 }))).toContain(
      '128E/8',
    );
  });

  it('shows an expert count on its own when the config gives no top-k', () => {
    expect(archChips(group(), model({ n_routed_experts: 160 }))).toContain('160E');
  });

  it('leaves out what the run did not say rather than showing a dash', () => {
    // Every other chip on the card is a fact. One that says "not known" reads
    // as one more of them.
    expect(archChips(group(), undefined)).toEqual([]);
  });

  it('does not put the run’s bookkeeping on the card', () => {
    // `params` is passed through whole, so most of what is in it is not about
    // shape: a routing seed, a path to a file, a memory budget. The card has
    // room for about five short strings, and these are not them.
    expect(
      archChips(
        group({
          params: {
            model_config: 'model/config/qwen3_235b_fp8.json',
            routing_seed: 7,
            expert_popularity_file: 'presets/x.json',
          },
        }),
        undefined,
      ),
    ).toEqual([]);
  });

  it('shows dtype only when the run records it explicitly', () => {
    // The legacy map did not infer a display dtype from fp8 bookkeeping or the
    // checkpoint. Keeping that contract avoids adding a chip that was absent
    // from the source UI.
    expect(archChips(group({ params: { fp8: true } }), model({ torch_dtype: 'bfloat16' }))).toEqual(
      [],
    );
    expect(
      archChips(group({ params: { fp8: false } }), model({ torch_dtype: 'bfloat16' })),
    ).toEqual([]);
    expect(
      archChips(group({ params: { dtype: 'bfloat16' } }), model({ torch_dtype: 'float16' })),
    ).toEqual(['bfloat16']);
  });
});
