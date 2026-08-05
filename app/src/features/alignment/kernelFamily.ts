import { GROUP, colorOf } from '../../domain/cost-tree';
import type { GROUP_ORDER } from '../../domain/cost-tree';

/**
 * The analyzer's vocabulary for a measured kernel, translated into the shared
 * cost-tree family.
 *
 * The modelled side already speaks that vocabulary — a slot's `kind` is
 * `single_gemm` or `rms_norm` and colours through `colorOf` directly. The
 * measured side does not: nsys sees a vendor kernel's mangled symbol, and the
 * labeler files it under its own coarser category. This table is the join, and
 * it exists so that a GEMM is the same blue on both lanes of the same axis.
 * Adding an alignment palette instead would have made the two lanes
 * incomparable by colour, which is the one thing the card is for.
 *
 * An unrecognized category falls to `misc`, the same fallback `groupOf` uses.
 */

const MEASURED_CATEGORY_FAMILY: Readonly<Record<string, (typeof GROUP_ORDER)[number]>> = {
  gemm_or_cutlass: 'gemm',
  attention: 'attn',
  multimem_all_reduce: 'comm',
  nccl_collective: 'comm',
  norm_reduce: 'norm',
  activation: 'norm',
  fill: 'norm',
  copy_other: 'misc',
  other: 'misc',
};

/** The mapped operation's declared type, for rows the labeler tied to a slot.
 * It is more specific than the kernel category — `collective_norm` is a fused
 * kernel doing both — so it wins where both are known. */
const OPERATION_TYPE_FAMILY: Readonly<Record<string, (typeof GROUP_ORDER)[number]>> = {
  gemm: 'gemm',
  gemm_collective: 'gemm',
  attention: 'attn',
  collective: 'comm',
  collective_norm: 'comm',
  norm: 'norm',
  activation: 'norm',
  routing: 'route',
};

export function measuredKernelFamily(
  category: string,
  operationType?: string | null,
): (typeof GROUP_ORDER)[number] {
  if (operationType) {
    const byOperation = OPERATION_TYPE_FAMILY[operationType];
    if (byOperation !== undefined) return byOperation;
  }
  return MEASURED_CATEGORY_FAMILY[category] ?? 'misc';
}

export function measuredKernelColor(category: string, operationType?: string | null): string {
  return GROUP[measuredKernelFamily(category, operationType)].color;
}

/** A modelled slot colours through the shared cost-tree table unchanged. */
export const simulatedSlotColor = (kind: string): string => colorOf(kind);
