import { Box, Stack, Typography } from '@mui/material';
import { lazy, Suspense, type ReactNode } from 'react';
import { useViz } from './store';
import { currentWorker, workerTree } from './application/runSelection';
import { useActiveRunState } from './application/ActiveRunProvider';
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
import FocusDialog from './components/FocusDialog';

// Worker, kernel, and parallel scopes share the cost-tree/Motion feature. Keep
// that feature out of the cluster/pool entry path and load it at the drill edge.
const WorkerStage = lazy(() => import('./components/stages/WorkerStage'));

function SectionHead({
  id,
  idx,
  title,
  sub,
}: {
  id: string;
  idx: string;
  title: string;
  sub?: string;
}) {
  return (
    <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mx: 0.25, mb: 1.25 }}>
      <Box
        component="span"
        sx={{ fontFamily: tokens.mono, fontSize: 10, color: tokens.terra, letterSpacing: '.1em' }}
      >
        {idx}
      </Box>
      <Typography
        id={id}
        component="h2"
        sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 17, letterSpacing: '-.01em' }}
      >
        {title}
      </Typography>
      {sub && (
        <Typography
          sx={{
            ml: 'auto',
            fontFamily: tokens.mono,
            fontSize: 10.5,
            color: tokens.sub,
            textAlign: 'right',
          }}
        >
          {sub}
        </Typography>
      )}
    </Stack>
  );
}

function Section({
  idx,
  title,
  sub,
  children,
}: {
  idx: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const headingId = `run-section-${idx}`;
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ mt: 2 }}>
      <SectionHead id={headingId} idx={idx} title={title} sub={sub} />
      {children}
    </Box>
  );
}

/** The main stage renders a DIFFERENT view per drill scope (not a filtered
 *  version of the same panels): cluster→global metrics, pool→resources,
 *  worker→cost tree, kernel→performance + input distribution. */
function WorkerStageFallback() {
  return (
    <Box
      role="status"
      aria-busy="true"
      sx={{
        minHeight: { xs: 240, md: 300 },
        display: 'grid',
        placeItems: 'center',
        border: `1px solid ${tokens.hair}`,
        borderRadius: 2,
        background: tokens.tile,
        boxShadow: tokens.shadow,
      }}
    >
      <Typography sx={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
        Loading worker analysis…
      </Typography>
    </Box>
  );
}

function Stage() {
  const st = useViz();
  if (st.scope === 'cluster') return <ClusterStage />;
  if (st.scope === 'pool') return <PoolStage />;
  // Worker AND kernel — kernel is a sub-state (bottom panels swap).
  return (
    <Suspense fallback={<WorkerStageFallback />}>
      <WorkerStage />
    </Suspense>
  );
}

function Masthead({ hasRun }: { hasRun: boolean }) {
  return (
    <Box sx={{ borderBottom: `1.5px solid ${tokens.ink}`, pb: 2.5 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          mb: 1.6,
          fontFamily: tokens.mono,
          fontSize: 11,
          letterSpacing: '.28em',
          textTransform: 'uppercase',
          color: tokens.sub,
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: tokens.terra,
            boxShadow: '0 0 0 4px rgba(194,92,58,.14)',
          }}
        />
        <span>VibeSim Analyzer</span>
        <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
        <span>results + topology</span>
      </Stack>
      <Typography
        component="h1"
        sx={{
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: 'clamp(34px,5vw,60px)',
          lineHeight: 0.96,
          letterSpacing: '-.02em',
          color: tokens.ink,
        }}
      >
        VibeSim —{' '}
        <Box component="em" sx={{ fontStyle: 'italic', fontWeight: 500, color: tokens.teal }}>
          Run
        </Box>
      </Typography>
      <Stack
        direction="row"
        alignItems="flex-end"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 3.75, mt: 2.25 }}
      >
        <RunSwitcher />
        {hasRun && <KpiStatline />}
      </Stack>
    </Box>
  );
}

export default function App() {
  const activeRun = useActiveRunState();
  const run = activeRun.run;
  const st = useViz();
  if (!run) {
    return (
      <Box
        component="main"
        sx={{ maxWidth: 1560, mx: 'auto', px: { xs: 2.25, md: 5.5 }, pt: 3.75, pb: 10 }}
      >
        <Masthead hasRun={false} />
        <Box
          role="status"
          sx={{
            mt: 2,
            p: 2,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 2,
            background: tokens.tile,
          }}
        >
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 17 }}>
            {activeRun.status === 'error'
              ? 'Could not load simulation folder'
              : activeRun.status === 'empty'
                ? 'No simulation folders'
                : activeRun.status === 'selecting'
                  ? 'Loading simulation-folder catalog'
                  : 'Loading simulation folder'}
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub }}>
            {activeRun.error?.message ??
              (activeRun.status === 'empty'
                ? 'The repository returned an empty run catalog.'
                : 'Waiting for the repository data selected above.')}
          </Typography>
        </Box>
      </Box>
    );
  }

  const w = currentWorker(run, st);
  const role = st.poolRole ?? w.pool;
  const leaf = st.scope === 'kernel' ? leafById(workerTree(run, st), st.leafId) : null;
  const leafName = leaf ? leaf.slot!.name.split('.').pop() : '—';

  const stage: Record<typeof st.scope, { title: string; sub: string }> = {
    cluster: {
      title: 'Cluster outcome',
      sub: 'SLO · throughput · conservation — whole deployment',
    },
    pool: { title: `Pool · ${role}`, sub: 'utilization · KV occupancy · batch composition' },
    worker: {
      title: `Worker · ${w.id}`,
      sub: run.capabilities.workerIterations
        ? 'batch composition · cost tree · kernel throughput'
        : 'full-run aggregate kernel time share · iteration detail not generated',
    },
    kernel: {
      title: `Worker · ${w.id}`,
      sub: run.capabilities.kernelPerformance
        ? `cost tree · kernel · ${leafName}`
        : 'kernel detail not generated',
    },
    parallel: {
      title: `Worker · ${w.id}`,
      sub: run.capabilities.loadImbalance
        ? 'cost tree · parallel node · load imbalance + straggler'
        : 'load-imbalance detail not generated',
    },
  };
  const meta = stage[st.scope];

  return (
    <Box
      component="main"
      sx={{ maxWidth: 1560, mx: 'auto', px: { xs: 2.25, md: 5.5 }, pt: 3.75, pb: 10 }}
    >
      <Masthead hasRun />

      <ScopeBreadcrumbs />

      <RunOverviewRow />

      {/* 01 — persistent STRUCTURAL navigator: the system map is how you re-scope */}
      <Section
        idx="01"
        title="System map"
        sub={`${run.gpuTotal} GPUs · ${run.gpu} · ${run.deployment === 'afd' ? 'AFD (attn ∥ ffn)' : 'unified'} · click to scope`}
      >
        <SystemMapBand />
      </Section>

      {/* TEMPORAL navigators — orthogonal to the structural drill. Timeline
          (wall-clock) is always present; the worker-level Iteration band only
          appears once you're inside a worker (no iteration selection at
          cluster/pool scope). */}
      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {run.capabilities.concurrencyTimeline && <TimelineBand />}
        {run.capabilities.workerIterations &&
          (st.scope === 'worker' || st.scope === 'kernel' || st.scope === 'parallel') && (
            <IterationBand />
          )}
      </Stack>

      {/* execution trace — whole-run wall-clock view, only meaningful at
          cluster scope (structural drill has its own per-scope stage below) */}
      {st.scope === 'cluster' &&
        run.source.kind === 'synthetic' &&
        run.capabilities.perfettoTrace && (
          <Box sx={{ mt: 2 }}>
            <PerfettoTrace />
          </Box>
        )}

      {/* 02 — scope-adaptive stage */}
      <Section idx="02" title={meta.title} sub={meta.sub}>
        <Stage />
      </Section>

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{
          gap: 2,
          mt: 5,
          pt: 2,
          borderTop: `1px solid ${tokens.hair}`,
          fontFamily: tokens.mono,
          fontSize: 10.5,
          letterSpacing: '.1em',
          color: tokens.sub,
          textTransform: 'uppercase',
        }}
      >
        <span>VibeSim · analyzer prototype</span>
        <Box
          component="span"
          sx={{
            fontFamily: tokens.serif,
            fontStyle: 'italic',
            fontSize: 13,
            textTransform: 'none',
            letterSpacing: 0,
            color: tokens.ink,
          }}
        >
          {run.source.kind === 'synthetic'
            ? 'scope-adaptive · synthetic fixture'
            : `analyzer artifacts · ${run.source.simulationFolder}`}
        </Box>
        <span>Run ▸ Pool ▸ Worker ▸ Kernel</span>
      </Stack>

      <FocusDialog />
    </Box>
  );
}
