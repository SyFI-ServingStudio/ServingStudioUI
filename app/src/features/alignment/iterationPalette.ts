import { GROUP } from '../../domain/cost-tree';
import { tokens } from '../../theme';

/**
 * Stable rotating colours for iteration categories.
 *
 * Category spelling is identity only: no name is parsed or assigned a special
 * semantic hue. Every consumer supplies the same sorted category order, so a
 * newly introduced analyzer category receives the next colour instead of a
 * grey fallback or a guessed meaning.
 */
const ITERATION_TYPE_COLORS = [
  tokens.sectionAnalysis,
  GROUP.norm.color,
  tokens.terra,
  tokens.violet,
  tokens.gold,
  tokens.teal,
  GROUP.attn.color,
] as const;

export function iterationTypeOrder(iterationTypes: readonly string[]): readonly string[] {
  return [...new Set(iterationTypes)].sort((left, right) => left.localeCompare(right, 'en'));
}

export function iterationTypeColor(iterationType: string, typeOrder: readonly string[]): string {
  const position = typeOrder.indexOf(iterationType);
  return ITERATION_TYPE_COLORS[(position < 0 ? 0 : position) % ITERATION_TYPE_COLORS.length];
}
