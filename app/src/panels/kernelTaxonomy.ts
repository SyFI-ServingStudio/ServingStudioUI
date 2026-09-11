/**
 * What kinds of kernel there are, and which family each belongs to.
 *
 * One table, imported by both the cost tree and the kernel-time panels. It
 * lives outside either because it is a fact about the simulator's kernel
 * vocabulary rather than about any view of it — and because two copies of a
 * colour-and-label table drift silently: the same kernel would be blue in one
 * chart and grey in another, and nothing would fail.
 *
 * An unrecognized kind is `misc` rather than an error. The Analyzer's kernel
 * vocabulary grows independently of this build, and a run that uses a new
 * kernel should still render — grouped honestly as "Other" rather than
 * refusing to draw.
 */
import { colors } from '../ui/theme';

export const KIND: Readonly<Record<string, { readonly group: string; readonly label: string }>> = {
  single_gemm: { group: 'gemm', label: 'GEMM' },
  grouped_gemm: { group: 'gemm', label: 'Grouped GEMM' },
  flashinfer_attn_prefill: { group: 'attn', label: 'Attn · prefill' },
  flashinfer_attn_decode: { group: 'attn', label: 'Attn · decode' },
  kv_cache_append: { group: 'attn', label: 'KV append' },
  rms_norm: { group: 'norm', label: 'RMSNorm' },
  elementwise: { group: 'norm', label: 'Elementwise' },
  all_reduce: { group: 'comm', label: 'AllReduce' },
  p2p_intra: { group: 'comm', label: 'P2P · intra-NVL' },
  p2p_inter: { group: 'comm', label: 'P2P · inter-NVL' },
  moe_router: { group: 'route', label: 'MoE router' },
};

export const GROUP: Readonly<Record<string, { readonly label: string; readonly color: string }>> = {
  // These colors serve as both rails on light cards and filled time-share
  // blocks carrying white labels, so each must clear AA in both contexts.
  gemm: { label: 'Dense GEMM', color: colors.gemm },
  attn: { label: 'Attention', color: colors.attention },
  comm: { label: 'Collectives', color: colors.collective },
  norm: { label: 'Norm / EW', color: colors.normalization },
  route: { label: 'Routing', color: colors.routing },
  misc: { label: 'Other', color: colors.other },
};

export const GROUP_ORDER = ['gemm', 'attn', 'comm', 'norm', 'route', 'misc'] as const;

export const groupOf = (kind: string): string => KIND[kind]?.group ?? 'misc';
export const colorOf = (kind: string): string => GROUP[groupOf(kind)].color;
export const kindLabel = (kind: string): string => KIND[kind]?.label ?? kind;
