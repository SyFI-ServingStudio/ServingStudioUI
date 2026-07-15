import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useViz, currentRun, currentWorker, workerTree } from './store';
import { leafById } from './data/tree';
import { tokens } from './theme';
import RunSwitcher from './components/RunSwitcher';
import KpiStatline from './components/KpiStatline';
import ScopeBreadcrumbs from './components/ScopeBreadcrumbs';
import RunOverviewRow from './components/RunOverviewRow';
import SystemMapBand from './components/SystemMapBand';
import TimelineBand from './components/TimelineBand';
import IterationBand from './components/IterationBand';
import PerfettoTrace from './components/PerfettoTrace';
import ClusterStage from './components/stages/ClusterStage';
import PoolStage from './components/stages/PoolStage';
import WorkerStage from './components/stages/WorkerStage';
import FocusDialog from './components/FocusDialog';

function SectionHead({ idx, title, sub }: { idx: string; title: string; sub?: string }) {
  return (
    <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mx: 0.25, mb: 1.25 }}>
      <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 10, color: tokens.terra, letterSpacing: '.1em' }}>{idx}</Box>
      <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 17, letterSpacing: '-.01em' }}>{title}</Typography>
      {sub && <Typography sx={{ ml: 'auto', fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub, textAlign: 'right' }}>{sub}</Typography>}
    </Stack>
  );
}

function Section({ idx, title, sub, children }: { idx: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <SectionHead idx={idx} title={title} sub={sub} />
      {children}
    </Box>
  );
}

/** The main stage renders a DIFFERENT view per drill scope (not a filtered
 *  version of the same panels): cluster→global metrics, pool→resources,
 *  worker→cost tree, kernel→performance + input distribution. */
function Stage() {
  const st = useViz();
  if (st.scope === 'cluster') return <ClusterStage />;
  if (st.scope === 'pool') return <PoolStage />;
  return <WorkerStage />; // worker AND kernel — kernel is a sub-state (bottom panels swap)
}

export default function App() {
  const st = useViz();
  const run = currentRun(st);
  const w = currentWorker(st);
  const role = st.poolRole ?? w.pool;
  const leaf = st.scope === 'kernel' ? leafById(workerTree(st), st.leafId) : null;
  const leafName = leaf ? leaf.slot!.name.split('.').pop() : '—';

  const stage: Record<typeof st.scope, { title: string; sub: string }> = {
    cluster: { title: 'Cluster outcome', sub: 'SLO · throughput · conservation — whole deployment' },
    pool: { title: `Pool · ${role}`, sub: 'utilization · KV occupancy · batch composition' },
    worker: { title: `Worker · ${w.id}`, sub: 'batch composition · cost tree · kernel throughput' },
    kernel: { title: `Worker · ${w.id}`, sub: `cost tree · kernel · ${leafName}` },
    parallel: { title: `Worker · ${w.id}`, sub: 'cost tree · parallel node · load imbalance + straggler' },
  };
  const meta = stage[st.scope];

  return (
    <Box sx={{ maxWidth: 1560, mx: 'auto', px: { xs: 2.25, md: 5.5 }, pt: 3.75, pb: 10 }}>
      {/* masthead */}
      <Box sx={{ borderBottom: `1.5px solid ${tokens.ink}`, pb: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.6, fontFamily: tokens.mono, fontSize: 11, letterSpacing: '.28em', textTransform: 'uppercase', color: tokens.sub }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: tokens.terra, boxShadow: '0 0 0 4px rgba(194,92,58,.14)' }} />
          <span>VibeSim Analyzer</span>
          <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
          <span>results + topology</span>
        </Stack>
        <Typography component="h1" sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 'clamp(34px,5vw,60px)', lineHeight: 0.96, letterSpacing: '-.02em', color: tokens.ink }}>
          VibeSim — <Box component="em" sx={{ fontStyle: 'italic', fontWeight: 500, color: tokens.teal }}>Run</Box>
        </Typography>
        <Stack direction="row" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap" useFlexGap sx={{ gap: 3.75, mt: 2.25 }}>
          <RunSwitcher />
          <KpiStatline />
        </Stack>
      </Box>

      <ScopeBreadcrumbs />

      <RunOverviewRow />

      {/* 01 — persistent STRUCTURAL navigator: the system map is how you re-scope */}
      <Section idx="01" title="System map" sub={`${run.gpuTotal} GPUs · ${run.gpu} · ${run.deployment === 'afd' ? 'AFD (attn ∥ ffn)' : 'unified'} · click to scope`}>
        <SystemMapBand />
      </Section>

      {/* TEMPORAL navigators — orthogonal to the structural drill. Timeline
          (wall-clock) is always present; the worker-level Iteration band only
          appears once you're inside a worker (no iteration selection at
          cluster/pool scope). */}
      <Stack spacing={1.5} sx={{ mt: 2 }}>
        <TimelineBand />
        {(st.scope === 'worker' || st.scope === 'kernel' || st.scope === 'parallel') && <IterationBand />}
      </Stack>

      {/* execution trace — whole-run wall-clock view, only meaningful at
          cluster scope (structural drill has its own per-scope stage below) */}
      {st.scope === 'cluster' && (
        <Box sx={{ mt: 2 }}>
          <PerfettoTrace />
        </Box>
      )}

      {/* 02 — scope-adaptive stage */}
      <Section idx="02" title={meta.title} sub={meta.sub}>
        <Stage />
      </Section>

      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 2, mt: 5, pt: 2, borderTop: `1px solid ${tokens.hair}`, fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: '.1em', color: tokens.sub, textTransform: 'uppercase' }}>
        <span>VibeSim · analyzer prototype</span>
        <Box component="span" sx={{ fontFamily: tokens.serif, fontStyle: 'italic', fontSize: 13, textTransform: 'none', letterSpacing: 0, color: tokens.ink }}>scope-adaptive · fake data</Box>
        <span>Run ▸ Pool ▸ Worker ▸ Kernel</span>
      </Stack>

      <FocusDialog />
    </Box>
  );
}
