import type { Iteration } from '../../data/iterations';

/** Presentation-only phase palette. Iteration identity and selection remain in
 * the application/data boundary because CostTree consumers share them. */
export const PHASE_COLOR: Record<Iteration['phase'], string> = {
  prefill: '#a84b2e',
  mixed: '#806600',
  decode: '#1f6f6b',
};
