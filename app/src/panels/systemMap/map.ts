/**
 * The system map as data: what to draw, and what is currently selected.
 *
 * Pure and separate from the component, because both halves of this are
 * judgements worth arguing with in a test rather than reading out of JSX.
 *
 * The first judgement is which architecture facts are worth a chip. The run's
 * `params` carry everything the simulator was told, most of which is not about
 * shape — a cache policy, a path to an expert-popularity file — and the map has
 * room for about five short strings. The second is what "selected" means at
 * each level, which is not simply "the address names it": a reader who has
 * opened a worker is also, still, inside its pool, and a map that lit only the
 * worker would leave them unable to see where they are.
 */
import { modelNumber, type RunModel, type RunTopology, type TopologyGroup } from '../../artifacts';
import { segmentOf, type Focus } from '../../location';

/** What the map draws, top to bottom. */
export interface SystemMap {
  readonly cluster: ClusterBand;
  readonly pools: readonly PoolCard[];
}

export interface ClusterBand {
  readonly pools: number;
  readonly gpus: number;
  readonly deployment: RunTopology['deployment'];
  /** True when the address names no pool: the reader is looking at the whole run. */
  readonly selected: boolean;
}

export interface PoolCard {
  /** Both the heading and the path segment. */
  readonly tag: string;
  readonly placement: string;
  readonly archType: string;
  readonly workerType: string;
  readonly gpu: string;
  readonly gpus: number;
  readonly replicas: number;
  readonly gpusPerReplica: number;
  /** Already formatted, in reading order. The panel prints them. */
  readonly chips: readonly string[];
  readonly selected: boolean;
  readonly workers: readonly WorkerChip[];
}

export interface WorkerChip {
  readonly id: string;
  readonly gpus: readonly number[];
  readonly selected: boolean;
}

export function systemMap(
  topology: RunTopology,
  model: RunModel | undefined,
  focus: Focus,
): SystemMap {
  const pool = segmentOf(focus.path, 'pool');
  const worker = segmentOf(focus.path, 'worker');
  return {
    cluster: {
      pools: topology.pools.length,
      gpus: topology.gpus,
      deployment: topology.deployment,
      selected: pool === null,
    },
    pools: topology.pools.map((entry) => ({
      tag: entry.tag,
      placement: entry.placement,
      archType: entry.group.archType,
      workerType: entry.group.workerType,
      gpu: entry.group.gpu,
      gpus: entry.group.replicas * entry.group.gpusPerReplica,
      replicas: entry.group.replicas,
      gpusPerReplica: entry.group.gpusPerReplica,
      chips: archChips(entry.group, model),
      // A pool stays lit while the reader is inside one of its workers. The
      // address is a path, and every step of it is where the reader is.
      selected: pool?.role === entry.tag,
      workers: entry.group.workers.map((instance) => ({
        id: instance.id,
        gpus: instance.gpus,
        selected: pool?.role === entry.tag && worker?.id === instance.id,
      })),
    })),
  };
}

/**
 * The sharding parameters, spelled as the simulator's arch selectors spell them.
 *
 * These are the names in `IterArchSel` (`simulator/src/arch/config.rs`), and
 * they are per-family on purpose: `Llama3DenseTp` has a single `tp_size`, while
 * the disaggregated selectors split it into `attn_tp_size` and `ffn_tp_size`
 * because those are two different numbers on the same run. A table of guessed
 * aliases would not have protected against that — it would only have made the
 * card silently blank on whichever family was guessed wrong.
 *
 * A vocabulary, and therefore something that grows as the simulator grows. The
 * alternative considered was showing every numeric parameter: that needs no
 * maintenance but fills the card with `routing_seed` and
 * `attn_gpu_memory_gb`, and the point of these chips is that a reader takes
 * them in at a glance.
 */
const SHAPE: readonly (readonly [string, string])[] = [
  ['tp_size', 'TP'],
  ['attn_tp_size', 'attn TP'],
  ['ffn_tp_size', 'FFN TP'],
  ['ep_size', 'EP'],
  ['hp_size', 'HP'],
  ['nvl_num_gpu', 'NVL'],
];

/**
 * How the model was shaped and split, in the fewest strings that say it.
 *
 * Precedence is not one rule, because the two sources are not two answers to
 * one question:
 *
 * - **Layers.** The simulator resolves one number, `sim_num_layers ?? num_layers`
 *   over the checkpoint's `num_hidden_layers`, and that is how many layers it
 *   actually ran. So the chip is that number and not the checkpoint's: a
 *   two-layer simulation of a 32-layer model that said `L=32` would describe a
 *   measurement nobody took. Where the two differ the chip says both — the
 *   truncation is the most important thing on the card, because every latency
 *   on the page was extrapolated from it.
 * - **Precision.** `fp8` is a run parameter; `torch_dtype` is the checkpoint's
 *   own dtype. An fp8 run of a bf16 checkpoint is ordinary, so showing both
 *   would read as a contradiction — the run wins, because it is what executed.
 * - **Experts.** Only the checkpoint knows, so only the config is consulted.
 *
 * Where nothing answers, the chip is left out rather than shown with a dash —
 * every other chip on the card is a fact, and one that says "not known" reads
 * as one more of them.
 */
export function archChips(group: TopologyGroup, model: RunModel | undefined): string[] {
  const chips: string[] = [];
  const chip = layerChip(group, model);
  if (chip !== undefined) chips.push(chip);
  for (const [key, label] of SHAPE) {
    const value = number(group.params[key]);
    if (value !== undefined) chips.push(`${label}=${value}`);
  }
  const experts = modelNumber(model, 'num_experts') ?? modelNumber(model, 'n_routed_experts');
  if (experts !== undefined) {
    const topK = modelNumber(model, 'num_experts_per_tok');
    // "128E/8" is the pair a reader of a mixture-of-experts run wants, and the
    // count alone does not say how much of it runs per token. When the config
    // gives one and not the other, the one is still worth having.
    chips.push(topK === undefined ? `${experts}E` : `${experts}E/${topK}`);
  }
  const dtype = text(group.params.dtype);
  if (dtype !== undefined) chips.push(dtype);
  return chips;
}

/**
 * How many layers ran, and — when it is not the whole model — out of how many.
 *
 * `num_layers` is the depth the run was asked to represent, defaulting to the
 * checkpoint's. `sim_num_layers` truncates what is actually executed, the rest
 * being scaled from it. Only the second is a measurement, so it is the number
 * on the chip; the first is there to say how much of the model it stands for.
 */
function layerChip(group: TopologyGroup, model: RunModel | undefined): string | undefined {
  const configured = number(group.params.num_layers) ?? modelNumber(model, 'num_hidden_layers');
  const simulated = number(group.params.sim_num_layers);
  const ran = simulated ?? configured;
  if (ran === undefined) return undefined;
  if (configured === undefined || configured === ran) return `L=${ran}`;
  return `L=${ran} of ${configured}`;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
