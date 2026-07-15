import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useViz } from '../../store';
import { currentWorker, cursorSeconds } from '../../application/runSelection';
import { useActiveRun } from '../../application/ActiveRunProvider';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { useProjectedWorkerTree } from '../../application/useProjectedWorkerTree';
import {
  leafTotals,
  leafByName,
  leafById,
  nodeById,
  colorOf,
  type CostNode,
} from '../../data/tree';
import { kernelPerf, inputDist } from '../../data/kernel';
import { imbalanceFor } from '../../data/imbalance';
import { workerBatchFor } from '../../data/scopeData';
import {
  batchOption,
  kernelThroughputOption,
  rooflineOption,
  inputDistOption,
  imbalanceOverTimeOption,
  CHART_THEME,
  type KernelLoc,
} from '../../charts/options';
import { metricView, METRIC_TITLES, METRIC_CAPTIONS } from '../../charts/metricOption';
import CostTreeFlow from '../CostTreeFlow';
import TimeShareBlocks from '../TimeShareBlocks';
import KernelDetail from '../KernelDetail';
import ParallelDetail from '../ParallelDetail';
import ChartCard from '../ChartCard';
import { tokens } from '../../theme';

/** Worker-scope bottom: scheduler pressure/composition, time-share, and kernel throughput. */
function WorkerBottom() {
  const st = useViz();
  const run = useActiveRun();
  const tree = useProjectedWorkerTree();
  const worker = currentWorker(run, st);
  const backpressure = metricView('backpressure', run, st);
  const batch = workerBatchFor(run, worker.key);
  const lt = leafTotals(tree);
  const locs: KernelLoc[] = lt.positions.slice(0, 10).map((p) => {
    const node = leafByName(tree, p.name)!;
    const perf = kernelPerf(node);
    return {
      name: p.name,
      kind: p.kind,
      color: colorOf(p.kind),
      tflops: perf.tflops,
      gbps: perf.gbps,
      computeUtil: perf.computeUtil,
      memUtil: perf.memUtil,
      pct: p.pct,
    };
  });
  return (
    <>
      <ChartCard
        idx="a"
        title={METRIC_TITLES.backpressure}
        sub={backpressure.sub}
        option={backpressure.option}
        note={backpressure.note}
        empty={backpressure.note ?? undefined}
        caption={METRIC_CAPTIONS.backpressure}
      />
      <ChartCard
        idx="b"
        title="Batch composition"
        sub={`worker: ${worker.id}`}
        option={batchOption(batch, CHART_THEME, cursorSeconds(st))}
        note="prefill ∥ decode tokens per iteration · concurrent decode requests (right axis)"
        caption="This worker's batched tokens per scheduler iteration, split into prefill and decode work, with concurrent decode requests on the right axis. The selected iteration is shared with the iteration strip and cost tree."
      />
      <TimeShareBlocks />
      <ChartCard
        idx="c"
        title="Kernel throughput"
        sub={`achieved vs H200 peak · top ${locs.length}`}
        option={kernelThroughputOption(locs, CHART_THEME)}
        height={Math.max(210, locs.length * 26 + 46)}
        note="click a leaf in the cost tree above to inspect one kernel"
        caption="Per cost-tree position: achieved compute (TFLOP/s) and memory bandwidth (GB/s) as a fraction of the H200 roofline. A long orange bar = compute-bound; a long teal bar = bandwidth-bound."
      />
    </>
  );
}

/** Kernel-scope bottom: identity + roofline + backend-selection distribution.
 *  Replaces WorkerBottom in place — the cost tree hero above is untouched. */
function KernelBottom({ node }: { node: CostNode }) {
  const perf = kernelPerf(node);
  const dist = inputDist(node);
  const name = node.slot!.name;
  const multi = dist.backends.length > 1;
  return (
    <>
      <KernelDetail />
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}
      >
        <ChartCard
          idx="a"
          title="Roofline"
          sub={`${perf.boundedBy}-bound`}
          option={rooflineOption(perf, name, CHART_THEME)}
          note={`${perf.tflops} TFLOP/s · ${perf.gbps} GB/s · AI ${perf.intensity} FLOP/byte`}
          caption="Where this kernel sits against the H200 roofline. Points left of the ridge are memory-bandwidth-bound; points on the flat ceiling are compute-bound."
        />
        <ChartCard
          idx="b"
          title="Input distribution"
          sub={multi ? `backend selection · ${dist.backends.length} candidates` : 'single backend'}
          option={inputDistOption(dist, CHART_THEME)}
          note={
            multi
              ? 'each point = a sampled call, colored by the backend the cost model selected'
              : 'only one backend is registered for this kernel — no selection to visualize'
          }
          caption="Sampled calls plotted over two input features. Color shows which backend the cost model selected — clusters reveal the decision boundary across the input space."
        />
      </Box>
    </>
  );
}

/** Parallel-scope bottom: load imbalance across the Max node's lanes over time,
 *  plus the straggler kernel's roofline + input distribution. The cost tree hero
 *  above is untouched — the Max node is a sub-state of the worker view. */
function ParallelBottom({ node }: { node: CostNode }) {
  const st = useViz();
  const run = useActiveRun();
  const tree = useProjectedWorkerTree();
  const imb = imbalanceFor(run, currentWorker(run, st), node);
  const sLeaf = leafById(tree, imb.stragglerLeafId);
  const perf = sLeaf ? kernelPerf(sLeaf) : null;
  const dist = sLeaf ? inputDist(sLeaf) : null;
  const sName = sLeaf ? sLeaf.slot!.name : '';
  return (
    <>
      <ParallelDetail />
      <ChartCard
        idx="a"
        title="Load imbalance over time"
        sub={`${imb.lanes} ${imb.dim} lanes · straggler sets wall-time`}
        option={imbalanceOverTimeOption(imb, CHART_THEME)}
        height={240}
        note={`the straggler runs +${imb.maxImbalancePct}% over the mean lane at peak — that gap is idle time on the other lanes`}
        caption="Per-lane load across the parallel node over the run. The band is the min–max spread across lanes; the terra line is the straggler (the slowest lane, which the Max takes as the node's cost). A wide gap between straggler and mean is wasted concurrency from load imbalance."
      />
      {perf && dist && (
        <Box
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}
        >
          <ChartCard
            idx="b"
            title="Straggler roofline"
            sub={`${perf.boundedBy}-bound · ${sName.split('.').pop()}`}
            option={rooflineOption(perf, sName, CHART_THEME)}
            note={`${perf.tflops} TFLOP/s · ${perf.gbps} GB/s · AI ${perf.intensity} FLOP/byte`}
            caption="Achieved compute/bandwidth of the straggler lane's kernel against the H200 roofline — what the slowest lane is actually bounded by."
          />
          <ChartCard
            idx="c"
            title="Straggler input distribution"
            sub={
              dist.backends.length > 1
                ? `backend selection · ${dist.backends.length} candidates`
                : 'single backend'
            }
            option={inputDistOption(dist, CHART_THEME)}
            note={
              dist.backends.length > 1
                ? 'each point = a sampled call on the straggler kernel, colored by selected backend'
                : 'only one backend is registered for this kernel'
            }
            caption="Sampled calls on the straggler's kernel over two input features — how the slowest lane's work is distributed across the input space."
          />
        </Box>
      )}
    </>
  );
}

/** One worker's arch. The cost-tree hero is always on top; the bottom panels
 *  swap between worker-level (batch + time-share + throughput), kernel-level (detail +
 *  roofline + input distribution) when a leaf is selected, and parallel-level
 *  (load imbalance + straggler) when a Max node is selected. Kernel and parallel
 *  scopes are sub-states of the worker view, not separate views. */
function ReadyWorkerStage() {
  const st = useViz();
  const run = useActiveRun();
  const tree = useProjectedWorkerTree();
  // The current iteration/per-call helpers are synthetic authoring fixtures.
  // Real repositories must provide subject adapters before enabling this path.
  if (run.source.kind !== 'synthetic' || !run.capabilities.workerIterations) {
    return (
      <Stack spacing={2}>
        <Paper sx={{ borderRadius: 2, p: 2, borderLeft: `3px solid ${tokens.gold}` }}>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
            Aggregate worker evidence only
          </Typography>
          <Typography
            sx={{
              mt: 0.5,
              fontFamily: tokens.mono,
              fontSize: 10.5,
              lineHeight: 1.6,
              color: tokens.sub,
            }}
          >
            This folder provides run-aggregate kernel time share, but no interactive worker
            iteration index, batch detail, pending queue, kernel input distribution, or per-call
            roofline data. Missing subjects remain unavailable.
          </Typography>
        </Paper>
        <CostTreeFlow />
        <TimeShareBlocks />
      </Stack>
    );
  }
  const leaf = st.scope === 'kernel' && st.leafId != null ? leafById(tree, st.leafId) : null;
  const par = st.scope === 'parallel' && st.parId != null ? nodeById(tree, st.parId) : null;

  return (
    <Stack spacing={2}>
      <CostTreeFlow />
      {leaf ? (
        <KernelBottom node={leaf} />
      ) : par && par.kind === 'max' ? (
        <ParallelBottom node={par} />
      ) : (
        <WorkerBottom />
      )}
    </Stack>
  );
}

/** Local detail boundary: a missing worker artifact never replaces the
 * already-loaded overview, system map, or cluster/pool subjects. */
export default function WorkerStage() {
  const state = useActiveWorkerTreeState();
  if (state.status === 'loading' || state.status === 'idle') {
    const worker = state.status === 'loading' ? state.worker.key : 'selected worker';
    return (
      <Paper role="status" aria-busy="true" sx={{ borderRadius: 2, p: 3 }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          Loading worker cost tree
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
          Fetching aggregate kernel composition for {worker}…
        </Typography>
      </Paper>
    );
  }
  if (state.status === 'error') {
    return (
      <Paper role="alert" sx={{ borderRadius: 2, p: 3, borderLeft: `3px solid ${tokens.terra}` }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          Could not load worker cost tree
        </Typography>
        <Typography
          sx={{
            mt: 0.5,
            fontFamily: tokens.mono,
            fontSize: 11,
            color: tokens.sub,
            lineHeight: 1.6,
          }}
        >
          {state.error.message}
        </Typography>
        {state.retry && (
          <Button size="small" onClick={state.retry} sx={{ mt: 1.5 }}>
            Retry worker detail
          </Button>
        )}
      </Paper>
    );
  }
  return <ReadyWorkerStage />;
}
