import type { Run } from './data/fakeData';

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

export function shortName(r: Run): string {
  if (r.deployment === 'afd') return 'Qwen3 · AFD';
  if (r.summary.num_gpus === 1) return 'Llama-3 8B';
  return 'Qwen3 · MoE';
}
