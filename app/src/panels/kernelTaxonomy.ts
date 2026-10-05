/**
 * How a kernel kind is named and which family holds it: what each kind's DOC
 * declares (`title`, `category`), read once from the Analyzer
 * (`GET /api/analyzer/v1/kernel-kinds`).
 *
 * The UI keeps no table of kinds. A family is a DOC category; only its colour
 * is decided here, because that is presentation. A kind the read does not name
 * — the read is still pending or failed, or the kind has no DOC — is shown
 * under its own name in the `Other` family rather than refusing to draw.
 */
import { kernelKindsRef, useArtifact, type KernelKinds } from '../artifacts';
import { colors } from '../ui/theme';

export type { KernelKinds } from '../artifacts';

/** The family of a kind the DOCs do not name; also a DOC category. */
export const OTHER_FAMILY = 'Other';

export const NO_KERNEL_KINDS: KernelKinds = Object.freeze({ categories: [], kinds: {} });

/** The DOC categories' colours. These serve as both rails on light cards and
 * filled time-share blocks carrying white labels, so each must clear AA in both
 * contexts. A category without one draws as `Other`. */
const FAMILY_COLOR: Readonly<Record<string, string>> = {
  GEMM: colors.gemm,
  Attention: colors.attention,
  MoE: colors.routing,
  Communication: colors.collective,
  Normalization: colors.normalization,
  Quantization: colors.quantization,
  [OTHER_FAMILY]: colors.other,
};

/** Every family colour, for a palette that must not repeat a kernel family's hue. */
export const FAMILY_COLORS: readonly string[] = Object.values(FAMILY_COLOR);

export const familyOf = (kinds: KernelKinds, kind: string): string =>
  kinds.kinds[kind]?.category ?? OTHER_FAMILY;
export const familyColor = (family: string): string =>
  FAMILY_COLOR[family] ?? FAMILY_COLOR[OTHER_FAMILY];
export const kindColor = (kinds: KernelKinds, kind: string): string =>
  familyColor(familyOf(kinds, kind));
export const kindTitle = (kinds: KernelKinds, kind: string): string =>
  kinds.kinds[kind]?.title ?? kind;

/** The DOCs' kinds, or none while the read is pending or failed. */
export function useKernelKinds(): KernelKinds {
  const result = useArtifact(kernelKindsRef());
  return result.status === 'ready' ? result.value : NO_KERNEL_KINDS;
}
