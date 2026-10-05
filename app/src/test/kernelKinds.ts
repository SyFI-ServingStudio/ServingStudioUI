import type { KernelKinds } from '../artifacts';

/** The kernel-kinds read as the Analyzer serves it from the kind DOCs, cut to
 * the kinds the unit fixtures name. */
export const TEST_KERNEL_KINDS: KernelKinds = {
  categories: [
    'GEMM',
    'Attention',
    'MoE',
    'Communication',
    'Normalization',
    'Quantization',
    'Other',
  ],
  kinds: {
    single_gemm: { title: 'Dense GEMM', category: 'GEMM' },
    flashinfer_attn_decode: { title: 'Paged decode attention', category: 'Attention' },
    flashinfer_attn_prefill: { title: 'Causal prefill attention', category: 'Attention' },
    kv_cache_append: { title: 'Paged KV cache append', category: 'Attention' },
    all_reduce: { title: 'All-reduce', category: 'Communication' },
    rms_norm: { title: 'RMSNorm', category: 'Normalization' },
    elementwise: { title: 'Elementwise byte pass', category: 'Other' },
  },
};
