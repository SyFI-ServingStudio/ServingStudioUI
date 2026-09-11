import { Box, ButtonBase, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';

import { isPending, runModelRef, topologyRef, useArtifact } from '../../artifacts';
import { atRoot, selectSegment, withPath, type Focus } from '../../location';
import SurfaceCard from '../../ui/controls/SurfaceCard';
import { useSectionFrameSubtitle } from '../../ui/controls/SectionFrameSubtitleContext';
import { colors, tokens, withAlpha } from '../../ui/theme';
import { ReadProblem } from '../ReadProblem';
import type { PanelProps } from '../types';
import { systemMap, type PoolCard, type WorkerChip } from './map';

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function runLabel(sourcePath: string | undefined, deployment: string): string {
  const file = sourcePath?.split('/').at(-1) ?? 'model';
  const model = file.replace(/\.json$/i, '').replace(/[_-]+/g, ' ');
  return `${model} · ${deployment.toUpperCase()}`;
}

function deploymentMapLabel(deployment: 'unified' | 'pd' | 'afd'): string {
  if (deployment === 'afd') return 'AFD (attn ∥ ffn)';
  if (deployment === 'pd') return 'PD (prefill ∥ decode)';
  return 'unified';
}

function topologyGpuLabel(gpus: readonly string[]): string {
  const names = [...new Set(gpus)];
  if (names.length === 1) return names[0];
  return 'mixed GPU models';
}

function ParameterChip({ label }: { label: string }) {
  return (
    <Box
      component="span"
      sx={{
        px: 0.75,
        py: '1px',
        borderRadius: 0.75,
        border: `1px solid ${tokens.hair}`,
        background: tokens.tile,
        fontFamily: tokens.body,
        fontSize: 12,
        color: tokens.sub,
      }}
    >
      {label}
    </Box>
  );
}

function Worker({
  worker,
  pool,
  type,
  onClick,
}: {
  worker: WorkerChip;
  pool: string;
  type: string;
  onClick: () => void;
}) {
  const gpuCount = worker.gpus.length;
  const shown = Math.min(gpuCount, 8);
  return (
    <ButtonBase
      type="button"
      aria-label={`Scope to worker ${pool}/${worker.id}`}
      aria-pressed={worker.selected}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      data-testid={`system-map-worker-${pool}-${worker.id}`}
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        textAlign: 'left',
        flexDirection: 'column',
        gap: 0.6,
        minWidth: 118,
        cursor: 'pointer',
        p: '9px 11px',
        borderRadius: 1.25,
        transition: `all .28s ${tokens.ease}`,
        border: `1px solid ${worker.selected ? tokens.teal : tokens.hair}`,
        background: worker.selected ? withAlpha(tokens.teal, 0.1) : tokens.tile,
        boxShadow: worker.selected ? `inset 0 0 0 1px ${tokens.teal}` : 'none',
        '&:hover': {
          transform: 'translateY(-2px)',
          borderColor: worker.selected ? tokens.teal : colors.borderHover,
          boxShadow: worker.selected
            ? `inset 0 0 0 1px ${tokens.teal}, ${tokens.shadow}`
            : tokens.shadow,
        },
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: 14,
          color: worker.selected ? tokens.teal : tokens.ink,
        }}
      >
        {worker.id}
      </Typography>
      <Typography
        sx={{ fontFamily: tokens.body, fontSize: 12, letterSpacing: '.06em', color: tokens.sub }}
      >
        {type}
      </Typography>
      <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ gap: 0.5 }}>
        <Box
          component="i"
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.sub,
            fontStyle: 'normal',
            mr: 0.25,
          }}
        >
          {gpuCount} gpu
        </Box>
        {Array.from({ length: shown }).map((_, index) => (
          <Box
            key={index}
            sx={{
              width: 12,
              height: 12,
              borderRadius: 0.75,
              background: worker.selected
                ? withAlpha(tokens.teal, 0.34)
                : withAlpha(tokens.teal, 0.16),
              border: `1px solid ${withAlpha(tokens.teal, 0.28)}`,
            }}
          />
        ))}
        {gpuCount > shown && (
          <Box component="span" sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            +{gpuCount - shown}
          </Box>
        )}
      </Stack>
    </ButtonBase>
  );
}

function Pool({
  pool,
  onPool,
  onWorker,
}: {
  pool: PoolCard;
  onPool: () => void;
  onWorker: (id: string) => void;
}) {
  const roleColor =
    pool.tag === 'attn' ? tokens.teal : pool.tag === 'ffn' ? tokens.terra : tokens.sub;
  return (
    <Paper
      elevation={0}
      data-testid={`system-map-pool-${pool.tag}`}
      sx={{
        flex: '1 1 300px',
        minWidth: 260,
        p: '12px 13px',
        borderRadius: 1.5,
        background: pool.selected ? withAlpha(tokens.teal, 0.05) : tokens.tile2,
        border: `1px solid ${pool.selected ? tokens.teal : tokens.hair}`,
        boxShadow: pool.selected ? `inset 0 0 0 1px ${tokens.teal}` : 'none',
      }}
    >
      <ButtonBase
        type="button"
        aria-label={`Scope to pool ${pool.tag}`}
        aria-pressed={pool.selected && !pool.workers.some((worker) => worker.selected)}
        onClick={onPool}
        data-testid={`system-map-pool-button-${pool.tag}`}
        sx={{
          width: '100%',
          display: 'block',
          textAlign: 'left',
          borderRadius: 1,
          mb: 1.25,
          transition: `background .24s ${tokens.ease}`,
          '&:hover': { background: withAlpha(tokens.teal, 0.07) },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Typography
            sx={{
              fontFamily: tokens.serif,
              fontWeight: 600,
              fontSize: 15,
              textTransform: 'capitalize',
            }}
          >
            {pool.tag}
          </Typography>
          <Box
            component="span"
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: roleColor,
              px: 1,
              py: '2px',
              borderRadius: 0.75,
              border: `1px solid ${tokens.hair}`,
              background: tokens.tile,
            }}
          >
            {pool.placement}
          </Box>
          <Typography sx={{ ml: 'auto', fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            {pool.workers.length} {plural(pool.workers.length, 'worker')} · {pool.gpus} GPU
          </Typography>
        </Stack>
      </ButtonBase>
      <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 1, mb: 1 }}>
        <Box
          component="span"
          sx={{
            color: tokens.ink,
            fontWeight: 500,
            px: 0.9,
            py: '2px',
            borderRadius: 0.75,
            background: withAlpha(tokens.teal, 0.08),
            fontFamily: tokens.body,
            fontSize: 12,
          }}
        >
          {pool.archType}
        </Box>
        <Box component="span" sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
          {pool.replicas}×{pool.gpusPerReplica}={pool.gpus} GPU
        </Box>
        {pool.chips.map((label) => (
          <ParameterChip key={label} label={label} />
        ))}
      </Stack>
      <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 1 }}>
        {pool.workers.map((worker) => (
          <Worker
            key={worker.id}
            worker={worker}
            pool={pool.tag}
            type={pool.workerType}
            onClick={() => onWorker(worker.id)}
          />
        ))}
      </Stack>
    </Paper>
  );
}

export function SystemMapPanel({ location, navigate }: PanelProps) {
  const result = location.ref;
  const topology = useArtifact(useMemo(() => topologyRef(result), [result]));
  const model = useArtifact(useMemo(() => runModelRef(result), [result]));
  const go = (focus: Focus) => navigate({ ...location, focus }, 'push');
  const sectionSubtitle =
    topology.status === 'ready'
      ? `${topology.value.gpus} GPUs · ${topologyGpuLabel(
          topology.value.pools.map((pool) => pool.group.gpu),
        )} · ${deploymentMapLabel(topology.value.deployment)} · click to scope`
      : undefined;
  useSectionFrameSubtitle(sectionSubtitle);

  if (isPending(topology) || isPending(model)) {
    return <Skeleton variant="rounded" height={160} data-testid="system-map-loading" />;
  }
  if (topology.status !== 'ready') {
    return (
      <Box data-testid="system-map-problem">
        <ReadProblem what="This run's topology" result={topology} />
      </Box>
    );
  }
  const map = systemMap(
    topology.value,
    model.status === 'ready' ? model.value : undefined,
    location.focus,
  );

  return (
    <SurfaceCard
      accent={tokens.olive}
      component="section"
      aria-labelledby="deployment-map-title"
      data-testid="system-map"
      sx={{ p: 1.9 }}
    >
      <Typography
        id="deployment-map-title"
        component="h3"
        sx={{ mb: 1, fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}
      >
        Deployment
      </Typography>
      <ButtonBase
        type="button"
        aria-label="Scope to whole deployment"
        aria-pressed={map.cluster.selected}
        onClick={() => go(atRoot(location.focus))}
        data-testid="system-map-cluster"
        sx={{
          width: '100%',
          display: 'flex',
          justifyContent: 'flex-start',
          textAlign: 'left',
          alignItems: 'center',
          gap: 1.5,
          mb: 1.9,
          p: '10px 13px',
          borderRadius: 1.5,
          cursor: 'pointer',
          border: `1px solid ${map.cluster.selected ? tokens.teal : tokens.hair}`,
          background: map.cluster.selected ? withAlpha(tokens.teal, 0.08) : tokens.tile2,
          boxShadow: map.cluster.selected ? `inset 0 0 0 1px ${tokens.teal}` : 'none',
          transition: `all .3s ${tokens.ease}`,
          '&:hover': {
            borderColor: map.cluster.selected ? tokens.teal : colors.borderHover,
            boxShadow: map.cluster.selected ? `inset 0 0 0 1px ${tokens.teal}` : tokens.shadow,
          },
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: map.cluster.selected ? tokens.teal : tokens.sub2,
            boxShadow: map.cluster.selected ? `0 0 0 3px ${withAlpha(tokens.teal, 0.15)}` : 'none',
          }}
        />
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 15,
            color: map.cluster.selected ? tokens.teal : tokens.ink,
          }}
        >
          {runLabel(
            model.status === 'ready' ? model.value.sourcePath : undefined,
            map.cluster.deployment,
          )}
          <Box
            component="span"
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              fontWeight: 400,
              color: tokens.sub,
              ml: 1,
            }}
          >
            · whole deployment
          </Box>
        </Typography>
        <Box
          component="span"
          sx={{
            ml: 'auto',
            fontFamily: tokens.body,
            fontSize: 12,
            color: map.cluster.selected ? tokens.teal : tokens.sub,
          }}
        >
          {map.cluster.pools} {plural(map.cluster.pools, 'pool')} · {map.cluster.gpus} GPU ·{' '}
          {map.cluster.selected ? 'selected — cluster metrics' : 'click for cluster metrics'}
        </Box>
      </ButtonBase>
      <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 1.75 }}>
        {map.pools.map((pool) => (
          <Pool
            key={pool.tag}
            pool={pool}
            onPool={() => go(selectSegment(location.focus, { at: 'pool', role: pool.tag }))}
            onWorker={(id) =>
              go(
                withPath(location.focus, [
                  { at: 'pool', role: pool.tag },
                  { at: 'worker', id },
                ]),
              )
            }
          />
        ))}
      </Stack>
    </SurfaceCard>
  );
}
