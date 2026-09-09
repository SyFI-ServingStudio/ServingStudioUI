import { Box, Link, Stack, Typography } from '@mui/material';
import { lazy, Suspense, type ReactNode, useEffect } from 'react';
import { useViz, type Scope } from './store';
import { useActiveRunState } from './application/ActiveRunProvider';
import { ActiveWorkerTreeProvider } from './application/WorkerTreeProvider';
import { tokens, withAlpha } from './theme';
import type { Deployment } from './domain/deployment';
import { KpiStatline, RunOverviewRow } from './features/run-overview';
import { ScopeBreadcrumbs, SystemMapBand } from './features/system-map';
import { TimelineBand } from './features/timeline';
import { PerfettoTrace } from './features/trace';
import { ClusterStage } from './features/cluster';
import { PoolStage } from './features/pool';
import { OptimalityAnalysisStage } from './features/optimality';
import WorkerAnalysisLevelControl from './features/worker/WorkerAnalysisLevelControl';
import { SurfaceAccentProvider } from './components/SurfaceCard';
import {
  ANALYZER_NAVIGATION_RESULT_EVENT,
  analyzerEvidenceHref,
  evidenceRefFromHash,
} from './domain/analyzerNavigation';

// Worker, kernel, and parallel scopes share the cost-tree/Motion feature. Keep
// that feature out of the cluster/pool entry path and load it at the drill edge.
const WorkerStage = lazy(() =>
  import('./features/worker').then((feature) => ({ default: feature.WorkerStage })),
);

function SectionHead({
  id,
  idx,
  title,
  sub,
  accent,
  controls,
}: {
  id: string;
  idx: string;
  title: string;
  sub?: string;
  accent: string;
  controls?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      alignItems="baseline"
      flexWrap="wrap"
      useFlexGap
      spacing={1.5}
      sx={{ mx: 0.25, mb: 1.25 }}
    >
      <Box
        component="span"
        sx={{ fontFamily: tokens.body, fontSize: 12, color: accent, letterSpacing: '.1em' }}
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
      {(controls || sub) && (
        <Stack
          direction="row"
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ ml: 'auto', gap: 1 }}
        >
          {controls}
          {sub && (
            <Typography
              sx={{
                fontFamily: tokens.body,
                fontSize: 12,
                color: tokens.sub,
                textAlign: 'right',
              }}
            >
              {sub}
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function Section({
  idx,
  title,
  sub,
  accent,
  controls,
  children,
}: {
  idx: string;
  title: string;
  sub?: string;
  accent: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `run-section-${idx}`;
  return (
    <SurfaceAccentProvider accent={accent}>
      <Box component="section" aria-labelledby={headingId} sx={{ mt: 2 }}>
        <SectionHead
          id={headingId}
          idx={idx}
          title={title}
          sub={sub}
          accent={accent}
          controls={controls}
        />
        {children}
      </Box>
    </SurfaceAccentProvider>
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
      <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
        Loading worker analysis…
      </Typography>
    </Box>
  );
}

function Stage() {
  const scope = useViz((state) => state.scope);
  if (scope === 'cluster') return <ClusterStage />;
  if (scope === 'pool') return <PoolStage />;
  // Worker AND kernel — kernel is a sub-state (bottom panels swap).
  return (
    <Suspense fallback={<WorkerStageFallback />}>
      <WorkerStage />
    </Suspense>
  );
}

function deploymentMapLabel(deployment: Deployment): string {
  if (deployment === 'afd') return 'AFD (attn ∥ ffn)';
  if (deployment === 'pd') return 'PD (prefill ∥ decode)';
  return 'unified';
}

function Masthead({ hasRun, runName }: { hasRun: boolean; runName?: string }) {
  return (
    <Box sx={{ borderBottom: `1px solid ${tokens.hair}`, pb: 2.5 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          mb: 1.6,
          fontFamily: tokens.body,
          fontSize: 12,
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
            boxShadow: `0 0 0 4px ${withAlpha(tokens.terra, 0.14)}`,
          }}
        />
        <span>VibeSim Analyzer</span>
        <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
        <Link
          href="#/aggregate"
          underline="none"
          aria-label="Return to aggregate overview"
          sx={{
            display: 'inline-flex',
            minHeight: 30,
            alignItems: 'center',
            px: 1.35,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 999,
            background: tokens.tile,
            color: tokens.ink,
            fontFamily: tokens.body,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.08em',
            textTransform: 'none',
            transition: `background 160ms ${tokens.ease}, border-color 160ms ${tokens.ease}`,
            '&:hover': { background: tokens.tile2, borderColor: tokens.teal },
            '&:focus-visible': {
              outline: `2px solid ${tokens.teal}`,
              outlineOffset: 2,
            },
          }}
        >
          ← Aggregate
        </Link>
      </Stack>
      <Typography
        component="h1"
        sx={{
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: 'clamp(30px,3vw,40px)',
          lineHeight: 1.15,
          letterSpacing: '-.02em',
          color: tokens.ink,
        }}
      >
        Run{' '}
        <Box component="span" sx={{ fontWeight: 600, color: tokens.ink }}>
          analysis
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
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              color: tokens.sub,
              fontFamily: tokens.body,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
            }}
          >
            Current run
          </Typography>
          <Typography
            title={runName}
            sx={{
              mt: 0.3,
              overflow: 'hidden',
              color: tokens.ink,
              fontFamily: tokens.serif,
              fontSize: 15,
              fontWeight: 600,
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {runName ?? 'Run identity unavailable'}
          </Typography>
        </Box>
        {hasRun && <KpiStatline />}
      </Stack>
    </Box>
  );
}

export default function App() {
  const activeRun = useActiveRunState();
  const run = activeRun.run;
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const workerAnalysisLevel = useViz((state) => state.workerAnalysisLevel);
  useEffect(() => {
    const evidence = evidenceRefFromHash(window.location.hash);
    if (
      evidence?.kind !== 'run' ||
      activeRun.status === 'loading' ||
      activeRun.status === 'selecting'
    ) {
      return;
    }
    const status =
      activeRun.status === 'ready'
        ? activeRun.run.id === evidence.runId
          ? 'ok'
          : 'not-found'
        : 'not-found';
    window.dispatchEvent(
      new CustomEvent(ANALYZER_NAVIGATION_RESULT_EVENT, {
        detail: { href: analyzerEvidenceHref(evidence), status },
      }),
    );
  }, [activeRun]);
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
          <Typography sx={{ mt: 0.5, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            {activeRun.error?.message ??
              (activeRun.status === 'empty'
                ? 'The repository returned an empty run catalog.'
                : 'Waiting for the repository data selected above.')}
          </Typography>
        </Box>
      </Box>
    );
  }

  const inWorkerScope = scope === 'worker' || scope === 'kernel' || scope === 'parallel';
  const worker = inWorkerScope
    ? (run.workerList.find((candidate) => candidate.key === workerKey) ?? null)
    : null;
  const role = poolRole ?? worker?.pool ?? '—';
  const hasHierarchicalWorkerDetail =
    activeRun.descriptor.details['worker-cost-tree']?.status === 'ready';

  const stage: Record<Scope, { title: string; sub: string }> = {
    cluster: {
      title: 'Cluster outcome',
      sub: 'SLO · throughput · conservation — whole deployment',
    },
    pool: {
      title: `Pool · ${role}`,
      sub: 'utilization · KV occupancy · batch composition · kernel time',
    },
    worker: {
      title: `Worker · ${worker?.key ?? 'invalid selection'}`,
      sub:
        workerAnalysisLevel === 'worker'
          ? 'worker aggregate resources · kernel composition'
          : hasHierarchicalWorkerDetail
            ? 'exact operation CostTree · worker operation timeline'
            : 'exact worker detail not generated',
    },
    kernel: {
      title: `Worker · ${worker?.key ?? 'invalid selection'}`,
      sub: 'CostTree leaf facts · Analyzer performance evidence',
    },
    parallel: {
      title: `Worker · ${worker?.key ?? 'invalid selection'}`,
      sub: 'pure Max critical path · load-imbalance detail not generated',
    },
  };
  const meta = stage[scope];
  return (
    <ActiveWorkerTreeProvider
      run={run}
      workerOperationDetail={activeRun.descriptor.details['worker-operation-index']}
      workerCostTreeDetail={activeRun.descriptor.details['worker-cost-tree']}
      analysisRevision={activeRun.descriptor.analysis?.revision}
    >
      <Box
        component="main"
        sx={{ maxWidth: 1560, mx: 'auto', px: { xs: 2.25, md: 5.5 }, pt: 3.75, pb: 10 }}
      >
        <Masthead hasRun runName={run.name} />

        <ScopeBreadcrumbs />

        {/* 00 — bounded identity and workload facts for the selected run. */}
        <Section idx="00" title="Overview" sub="model · deployment · workload" accent={tokens.teal}>
          <RunOverviewRow />
        </Section>

        {/* 01 — persistent STRUCTURAL navigator: the system map is how you re-scope */}
        <Section
          idx="01"
          title="System map"
          accent={tokens.sectionStructure}
          sub={`${run.gpuTotal} GPUs · ${run.gpu} · ${deploymentMapLabel(run.deployment)} · click to scope`}
        >
          <Stack spacing={1.5}>
            <SystemMapBand />

            {/* Timeline and whole-run trace are structural navigation over the
             * deployment, so they share the System map section and edge. */}
            <TimelineBand />
            {scope === 'cluster' && run.capabilities.perfettoTrace && <PerfettoTrace />}
          </Stack>
        </Section>

        {/* 02 — scope-adaptive stage */}
        <Section
          idx="02"
          title={meta.title}
          sub={meta.sub}
          accent={tokens.sectionAnalysis}
          controls={inWorkerScope ? <WorkerAnalysisLevelControl /> : undefined}
        >
          <Stage />
        </Section>

        <Section
          idx="03"
          title="Optimality analysis"
          sub="R0-R5 · batching · communication · hardware headroom"
          accent={tokens.gold}
        >
          <OptimalityAnalysisStage />
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
            fontFamily: tokens.body,
            fontSize: 12,
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
      </Box>
    </ActiveWorkerTreeProvider>
  );
}
