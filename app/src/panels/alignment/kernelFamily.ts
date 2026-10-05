import { familyColor, type KernelKinds } from '../kernelTaxonomy';

/**
 * The analyzer's vocabulary for a measured kernel, translated into the kernel
 * family (a kind DOC category) its modelled counterpart is drawn in.
 *
 * The modelled side names a slot's `kind`, whose DOC declares its category.
 * The measured side does not: nsys sees a vendor kernel's mangled symbol, and
 * the labeler files it under its own coarser category. This table is the join
 * from the labeler's names onto the DOC categories, and it exists so that a
 * GEMM is the same blue on both lanes of the same axis. Adding an alignment
 * palette instead would have made the two lanes incomparable by colour, which
 * is the one thing the card is for.
 *
 * An unrecognized category falls to the DOCs' `Other` category.
 */

const MEASURED_CATEGORY_FAMILY: Readonly<Record<string, string>> = {
  gemm_or_cutlass: 'GEMM',
  attention: 'Attention',
  multimem_all_reduce: 'Communication',
  nccl_collective: 'Communication',
  norm_reduce: 'Normalization',
  activation: 'Other',
  fill: 'Other',
  copy_other: 'Other',
  other: 'Other',
};

/** The mapped operation's declared type, for rows the labeler tied to a slot.
 * It is more specific than the kernel category — `collective_norm` is a fused
 * kernel doing both — so it wins where both are known. */
const OPERATION_TYPE_FAMILY: Readonly<Record<string, string>> = {
  gemm: 'GEMM',
  gemm_collective: 'GEMM',
  attention: 'Attention',
  collective: 'Communication',
  collective_norm: 'Communication',
  norm: 'Normalization',
  activation: 'Other',
  routing: 'MoE',
};

export function measuredKernelFamily(category: string, operationType?: string | null): string {
  if (operationType) {
    const byOperation = OPERATION_TYPE_FAMILY[operationType];
    if (byOperation !== undefined) return byOperation;
  }
  return MEASURED_CATEGORY_FAMILY[category] ?? 'Other';
}

export function measuredKernelColor(
  kinds: KernelKinds,
  category: string,
  operationType?: string | null,
): string {
  return familyColor(kinds, measuredKernelFamily(category, operationType));
}
