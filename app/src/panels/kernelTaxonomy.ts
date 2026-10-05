/**
 * How a kernel kind is named and which family holds it: what each kind's DOC
 * declares (`title`, `category`), read once from the Analyzer
 * (`GET /api/analyzer/v1/kernel-kinds`).
 *
 * The UI keeps no table of kinds or categories. A family is a DOC category,
 * and its colour is its position in the order the read lists the categories:
 * the DOCs own the order, the theme only the palette. A kind the read does
 * not name — the read is still pending or failed, or the kind has no DOC — is
 * shown under its own name in an unclassified family rather than refusing to
 * draw.
 */
import { kernelKindsRef, useArtifact, type KernelKinds } from '../artifacts';
import { colors, mixColor } from '../ui/theme';

export type { KernelKinds } from '../artifacts';

/** The family of a kind no DOC category names; not itself a DOC category. */
export const UNCLASSIFIED_FAMILY = 'Unclassified';

export const NO_KERNEL_KINDS: KernelKinds = Object.freeze({ categories: [], kinds: {} });

export const familyOf = (kinds: KernelKinds, kind: string): string =>
  kinds.kinds[kind]?.category ?? UNCLASSIFIED_FAMILY;

/** A family's colour: its category's position in the served order. A
 * position past the palette repeats a hue washed half-way toward the
 * unclassified grey, so it never reads as the family that hue first named. */
export function familyColor(kinds: KernelKinds, family: string): string {
  const position = kinds.categories.indexOf(family);
  if (position < 0) return colors.unclassifiedKernel;
  const palette = colors.kernelFamilies;
  const hue = palette[position % palette.length];
  return position < palette.length ? hue : mixColor(hue, colors.unclassifiedKernel, 0.5);
}

export const kindColor = (kinds: KernelKinds, kind: string): string =>
  familyColor(kinds, familyOf(kinds, kind));
export const kindTitle = (kinds: KernelKinds, kind: string): string =>
  kinds.kinds[kind]?.title ?? kind;

/** The DOCs' kinds, or none while the read is pending or failed. */
export function useKernelKinds(): KernelKinds {
  const result = useArtifact(kernelKindsRef());
  return result.status === 'ready' ? result.value : NO_KERNEL_KINDS;
}
