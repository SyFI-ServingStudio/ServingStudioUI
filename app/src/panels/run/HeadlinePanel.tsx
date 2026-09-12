/** The existing run masthead and overview, backed by schema-2 artifact reads. */
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';

import {
  catalogRef,
  isPending,
  runLatencyRef,
  runModelRef,
  runSummaryRef,
  runWorkloadRef,
  topologyRef,
  useArtifact,
} from '../../artifacts';
import { atRoot, segmentOf, upTo } from '../../location';
import AnalysisSection from '../../ui/controls/AnalysisSection';
import { tokens, withAlpha } from '../../ui/theme';
import { ReadProblem } from '../ReadProblem';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import { headlineStats, type Stat } from './headline';
import { OverviewCards } from './OverviewCards';

export function HeadlinePanel({ location, navigate }: PanelProps) {
  const result = location.ref;
  const summary = useArtifact(useMemo(() => runSummaryRef(result), [result]));
  const latency = useArtifact(useMemo(() => runLatencyRef(result), [result]));
  const topology = useArtifact(useMemo(() => topologyRef(result), [result]));
  const model = useArtifact(useMemo(() => runModelRef(result), [result]));
  const workload = useArtifact(useMemo(() => runWorkloadRef(result), [result]));
  const catalog = useArtifact(
    useMemo(() => catalogRef(result.workspace, 'run'), [result.workspace]),
  );

  if (isPending(summary) || isPending(latency) || isPending(topology) || isPending(catalog)) {
    return <Skeleton variant="rounded" height={560} data-testid="run-headline-loading" />;
  }
  if (summary.status !== 'ready') {
    return (
      <Box data-testid="run-headline-problem">
        <ReadProblem what="This run's summary" result={summary} />
      </Box>
    );
  }

  const stats = headlineStats(
    summary.value,
    latency.status === 'ready' ? latency.value : undefined,
  );
  const displayName =
    catalog.status === 'ready'
      ? (catalog.value.find(
          (entry) => entry.id === result.id && entry.workspace === result.workspace,
        )?.displayName ?? result.id)
      : result.id;

  return (
    <Box data-testid="run-headline">
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
          <span>ServingStudio Analyzer</span>
          <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
          <ButtonBase
            aria-label="Return to aggregate overview"
            onClick={() =>
              navigate(
                {
                  view: 'catalog',
                  filter: { workspace: result.workspace, kinds: [], query: null },
                },
                'push',
              )
            }
            sx={{
              minHeight: 30,
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
              '&:hover': { background: tokens.tile2, borderColor: tokens.teal },
            }}
          >
            ← Aggregate
          </ButtonBase>
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
          Run analysis
        </Typography>
        <Stack
          direction="row"
          alignItems="flex-end"
          justifyContent="space-between"
          flexWrap="wrap"
          useFlexGap
          sx={{ gap: 3.75, mt: 2.25 }}
        >
          <RunIdentity displayName={displayName} />
          <Stack
            direction="row"
            flexWrap="wrap"
            useFlexGap
            sx={{ gap: '6px 30px', alignItems: 'baseline' }}
          >
            {stats.map((stat) => (
              <Figure key={stat.label} stat={stat} />
            ))}
          </Stack>
        </Stack>
      </Box>

      <ScopeBreadcrumbs
        location={location}
        navigate={navigate}
        displayName={scopeRunLabel(
          model.status === 'ready' ? model.value.sourcePath : displayName,
          topology.status === 'ready' ? topology.value.deployment : undefined,
        )}
      />
      {latency.status === 'ready' ? null : (
        <Typography
          role="status"
          sx={{ mt: 0.5, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}
          data-testid="run-latency-problem"
        >
          Latency KPIs unavailable · {describeRead('the latency analysis', latency)?.message ?? ''}
        </Typography>
      )}

      <AnalysisSection
        idx="00"
        title="Overview"
        sub="model · deployment · workload"
        accent={tokens.teal}
      >
        {topology.status === 'ready' ? (
          <>
            {summary.value.gpus === topology.value.gpus ? null : (
              <Typography role="alert" sx={{ mt: 2, color: 'error.main' }}>
                Run summary reports {summary.value.gpus} GPUs, but topology reports{' '}
                {topology.value.gpus}.
              </Typography>
            )}
            <OverviewCards
              runId={displayName}
              topology={topology.value}
              model={model.status === 'ready' ? model.value : undefined}
              workload={workload}
            />
          </>
        ) : (
          <Box sx={{ mt: 2 }} data-testid="run-overview-problem">
            <ReadProblem what="This run's topology" result={topology} />
          </Box>
        )}
      </AnalysisSection>
    </Box>
  );
}

function RunIdentity({ displayName }: { readonly displayName: string }) {
  return (
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
        title={displayName}
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
        {displayName}
      </Typography>
    </Box>
  );
}

function scopeRunLabel(source: string, deployment: 'unified' | 'pd' | 'afd' | undefined): string {
  const basename = source.split('/').filter(Boolean).at(-1) ?? source;
  const model = basename.replace(/\.json$/i, '').replace(/_/g, ' ');
  return deployment === undefined ? model : `${model} · ${deployment.toUpperCase()}`;
}

function ScopeBreadcrumbs({
  location,
  navigate,
  displayName,
}: PanelProps & { readonly displayName: string }) {
  const pool = segmentOf(location.focus.path, 'pool');
  const worker = segmentOf(location.focus.path, 'worker');
  const leaf = segmentOf(location.focus.path, 'leaf');
  const parallel = segmentOf(location.focus.path, 'parallel');
  const scope = leaf
    ? 'kernel'
    : parallel
      ? 'parallel'
      : worker
        ? 'worker'
        : pool
          ? 'pool'
          : 'cluster';
  const parts = [
    { g: '▸', lab: displayName, here: scope === 'cluster', focus: atRoot(location.focus) },
    ...(pool
      ? [{ g: 'pool', lab: pool.role, here: scope === 'pool', focus: upTo(location.focus, 'pool') }]
      : []),
    ...(worker
      ? [
          {
            g: 'worker',
            lab: worker.id,
            here: scope === 'worker',
            focus: upTo(location.focus, 'worker'),
          },
        ]
      : []),
    ...(leaf ? [{ g: 'kernel', lab: String(leaf.id), here: true, focus: location.focus }] : []),
    ...(parallel
      ? [{ g: 'parallel', lab: String(parallel.id), here: true, focus: location.focus }]
      : []),
  ];
  const hint = {
    cluster: 'cluster — SLO · throughput · conservation',
    pool: 'pool — utilization · KV · batch composition · kernel time',
    worker: 'worker — exact operation CostTree',
    kernel: 'kernel — CostTree facts · Analyzer evidence state',
    parallel: 'parallel — pure Max critical path · imbalance not generated',
  }[scope];
  return (
    <Stack
      direction="row"
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      sx={{ gap: 1.1, my: 2.2 }}
    >
      {parts.map((part, index) => (
        <Stack key={`${part.g}-${part.lab}`} direction="row" alignItems="center" spacing={1.1}>
          {index > 0 && (
            <Box
              component="span"
              sx={{
                color: tokens.sub,
                opacity: 0.5,
                fontFamily: tokens.serif,
                fontStyle: 'italic',
              }}
            >
              /
            </Box>
          )}
          {part.here ? (
            <Box
              component="span"
              aria-current="page"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.9,
                px: 1.5,
                py: 0.6,
                borderRadius: 1.75,
                fontSize: 12.5,
                fontWeight: 600,
                border: `1px solid ${tokens.hair}`,
                color: tokens.ink,
                background: tokens.tile,
                boxShadow: tokens.shadow,
              }}
            >
              <Box component="span" sx={{ fontFamily: tokens.body, fontSize: 12, opacity: 0.7 }}>
                {part.g}
              </Box>
              {part.lab}
            </Box>
          ) : (
            <ButtonBase
              type="button"
              aria-label={`Scope to ${part.g} ${part.lab}`}
              onClick={() => navigate({ ...location, focus: part.focus }, 'push')}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.9,
                px: 1.5,
                py: 0.6,
                borderRadius: 1.75,
                fontSize: 12.5,
                fontWeight: 600,
                border: '1px solid transparent',
                color: tokens.sub,
                background: 'transparent',
                boxShadow: 'none',
                '&:hover': { color: tokens.ink, background: withAlpha(tokens.sub, 0.04) },
              }}
            >
              <Box component="span" sx={{ fontFamily: tokens.body, fontSize: 12, opacity: 0.7 }}>
                {part.g}
              </Box>
              {part.lab}
            </ButtonBase>
          )}
        </Stack>
      ))}
      <Typography
        sx={{
          ml: 'auto',
          fontFamily: tokens.body,
          fontSize: 12,
          color: tokens.sub2,
          letterSpacing: '.04em',
        }}
      >
        {hint}
      </Typography>
    </Stack>
  );
}

function Figure({ stat }: { stat: Stat }) {
  return (
    <Box>
      <Typography
        component="div"
        sx={{
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: 'clamp(22px,2.6vw,34px)',
          lineHeight: 1,
          letterSpacing: '-.015em',
          color: stat.lead ? tokens.teal : tokens.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {stat.value}
        {stat.unit === '' ? null : (
          <Box
            component="span"
            sx={{ fontSize: '.5em', fontWeight: 500, color: tokens.sub, ml: '3px' }}
          >
            {stat.unit}
          </Box>
        )}
      </Typography>
      <Typography
        sx={{
          fontFamily: tokens.body,
          fontSize: 12,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: tokens.sub,
          mt: 0.75,
        }}
      >
        {stat.label}
      </Typography>
    </Box>
  );
}
