import { annotate, type CostTree } from '../../domain/cost-tree';

interface LeafSpec {
  name: string;
  kind: string;
  base: number;
  config: string;
}

const leaf = ({ name, kind, base, config }: LeafSpec) => ({
  kind: 'leaf' as const,
  slot: { name, kind, config, backend: null },
  base,
  stats: { input: null, flops: null, bytes: null, tflops: null, gbps: null },
});

const postAttnBranch = () => ({
  kind: 'sum' as const,
  label: 'afd.post_attn (PostAttnRouterTpWorklet) [tp=4]',
  children: [
    leaf({
      name: 'afd.post_attn.o_proj',
      kind: 'single_gemm',
      base: 0.021587682887911797,
      config: 'm=515 n=6144 k=3072 · deepgemm fp8',
    }),
    leaf({
      name: 'afd.post_attn.tp_allreduce',
      kind: 'all_reduce',
      base: 0.02399979718029499,
      config: '3.16 MB · 4 GPU NVLink',
    }),
    {
      kind: 'sum' as const,
      label: 'afd.post_attn.moe_router (MoeRouterLocalWorklet)',
      children: [
        leaf({
          name: 'afd.post_attn.moe_router.post_attn_norm',
          kind: 'rms_norm',
          base: 0.00525309843942523,
          config: 'm=515 hidden=6144 · bf16',
        }),
        leaf({
          name: 'afd.post_attn.moe_router.router_gemm',
          kind: 'single_gemm',
          base: 0.011578990146517754,
          config: 'm=515 n=160 k=6144 · deepgemm fp8',
        }),
      ],
    },
  ],
});

const expertBranch = () => ({
  kind: 'sum' as const,
  label: 'afd.moe_expert_compute (MoeExpertComputeLocalWorklet)',
  children: [
    leaf({
      name: 'afd.moe_expert_compute.gate_up',
      kind: 'grouped_gemm',
      base: 0.18974405527114868,
      config: '8240 selections · 20/160 experts · fp8',
    }),
    leaf({
      name: 'afd.moe_expert_compute.activation',
      kind: 'elementwise',
      base: 0.003752197837457061,
      config: '1030 tokens · triton',
    }),
    leaf({
      name: 'afd.moe_expert_compute.down',
      kind: 'grouped_gemm',
      base: 0.10125437378883362,
      config: '8240 selections · 20/160 experts · fp8',
    }),
  ],
});

const preAttnBranch = () => ({
  kind: 'sum' as const,
  label: 'afd.pre_attn (PreAttnProjTpWorklet) [tp=4]',
  children: [
    leaf({
      name: 'afd.pre_attn.input_norm',
      kind: 'rms_norm',
      base: 0.00525309843942523,
      config: 'm=515 hidden=6144 · bf16',
    }),
    leaf({
      name: 'afd.pre_attn.qkv_proj',
      kind: 'single_gemm',
      base: 0.02615332417190075,
      config: 'm=515 n=3584 k=6144 · deepgemm fp8',
    }),
  ],
});

/** Fixed from analyzer-v1 exact operation ffn/1 · 9418/0/8. Repeated TP/EP
 * branches remain explicit because they are the structure the canvas must fit. */
export const COST_TREE_CANVAS_DEMO_TREE: CostTree = annotate({
  kind: 'sum',
  label: 'afd [AFD ffn (ep=8, dp=2) MoE top_k=8, 62 layers]',
  children: [
    { kind: 'max', overlap: 1, children: [postAttnBranch(), postAttnBranch()] },
    {
      kind: 'sum',
      children: [
        {
          kind: 'sum',
          children: [
            leaf({
              name: 'afd.moe_dispatch.dispatch_inter',
              kind: 'p2p_inter',
              base: 0,
              config: '0 B · InfiniBand',
            }),
            leaf({
              name: 'afd.moe_dispatch.dispatch_intra',
              kind: 'p2p_intra',
              base: 0.010797809809446335,
              config: '2.20 MB · NVLink',
            }),
          ],
        },
        { kind: 'max', overlap: 1, children: Array.from({ length: 8 }, expertBranch) },
        {
          kind: 'max',
          overlap: 1,
          children: Array.from({ length: 2 }, () =>
            leaf({
              name: 'afd.moe_local_reduce',
              kind: 'elementwise',
              base: 0.0031769147608429193,
              config: '515 tokens · triton',
            }),
          ),
        },
        {
          kind: 'sum',
          children: [
            leaf({
              name: 'afd.moe_combine.combine_intra_reduce',
              kind: 'p2p_intra',
              base: 0.012587499804794788,
              config: '3.82 MB · NVLink',
            }),
            leaf({
              name: 'afd.moe_combine.combine_inter_reduce',
              kind: 'p2p_inter',
              base: 0,
              config: '0 B · InfiniBand',
            }),
            leaf({
              name: 'afd.moe_combine.combine_inter_bcast',
              kind: 'p2p_inter',
              base: 0,
              config: '0 B · InfiniBand',
            }),
            leaf({
              name: 'afd.moe_combine.combine_intra_fanout',
              kind: 'p2p_intra',
              base: 0.010987651534378529,
              config: '2.37 MB · NVLink',
            }),
          ],
        },
      ],
    },
    { kind: 'max', overlap: 1, children: [preAttnBranch(), preAttnBranch()] },
  ],
});
