import { Box, Paper, Stack, Typography } from '@mui/material';
import { useViz } from '../store';
import { currentWorker } from '../application/runSelection';
import { useActiveRun } from '../application/ActiveRunProvider';
import { tokens } from '../theme';
import { shortName } from '../util';
import type { Group, WorkerInstance } from '../domain/run';
import { makeWorkerKey, makeWorkerRef } from '../domain/worker';

const chip = (label: string) => (
  <Box
    key={label}
    component="span"
    sx={{
      px: 0.75,
      py: '1px',
      borderRadius: 0.75,
      border: `1px solid ${tokens.hair}`,
      background: tokens.tile,
      fontFamily: tokens.mono,
      fontSize: 10.5,
      color: tokens.sub,
    }}
  >
    {label}
  </Box>
);

function archChips(g: Group): string[] {
  const p = g.arch.params;
  const cs: string[] = [`L=${p.layers ?? '—'}`];
  if (p.attn_tp) cs.push(`TP=${p.attn_tp}`);
  if (p.ep) cs.push(`EP=${p.ep}`);
  if (p.experts) cs.push(`${p.experts}E/${p.top_k ?? '?'}`);
  if (p.dtype) cs.push(String(p.dtype));
  return cs;
}

function WorkerChip({
  w,
  type,
  selected,
  onClick,
}: {
  w: WorkerInstance;
  type: string;
  selected: boolean;
  onClick: () => void;
}) {
  const ng = w.gpus.length;
  const shown = Math.min(ng, 8);
  return (
    <Box
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.6,
        minWidth: 118,
        cursor: 'pointer',
        p: '9px 11px',
        borderRadius: 1.25,
        transition: `all .28s ${tokens.ease}`,
        border: `1px solid ${selected ? tokens.teal : tokens.hair}`,
        background: selected ? 'rgba(31,111,107,.10)' : tokens.tile,
        boxShadow: selected ? `inset 0 0 0 1px ${tokens.teal}` : 'none',
        '&:hover': {
          transform: 'translateY(-2px)',
          borderColor: selected ? tokens.teal : '#cabf9f',
          boxShadow: selected ? `inset 0 0 0 1px ${tokens.teal}, ${tokens.shadow}` : tokens.shadow,
        },
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.serif,
          fontWeight: 600,
          fontSize: 14,
          color: selected ? tokens.teal : tokens.ink,
        }}
      >
        {w.id}
      </Typography>
      <Typography
        sx={{ fontFamily: tokens.mono, fontSize: 9.5, letterSpacing: '.06em', color: tokens.sub }}
      >
        {type}
        {w.dp ? ` · dp${w.dp}` : ''}
      </Typography>
      <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ gap: 0.5 }}>
        <Box
          component="i"
          sx={{
            fontFamily: tokens.mono,
            fontSize: 9,
            color: tokens.sub,
            fontStyle: 'normal',
            mr: 0.25,
          }}
        >
          {ng} gpu
        </Box>
        {Array.from({ length: shown }).map((_, i) => (
          <Box
            key={i}
            sx={{
              width: 12,
              height: 12,
              borderRadius: 0.75,
              background: selected ? 'rgba(31,111,107,.34)' : 'rgba(31,111,107,.16)',
              border: '1px solid rgba(31,111,107,.28)',
            }}
          />
        ))}
        {ng > shown && (
          <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}>
            +{ng - shown}
          </Box>
        )}
      </Stack>
    </Box>
  );
}

export default function SystemMapBand() {
  const st = useViz();
  const run = useActiveRun();
  const w = currentWorker(run, st);

  const clusterSel = st.scope === 'cluster';

  return (
    <Paper sx={{ p: 1.9, borderRadius: 2 }}>
      {/* whole-deployment selector — click to scope back up to the cluster */}
      <Box
        onClick={() => st.setCluster()}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          mb: 1.9,
          p: '10px 13px',
          borderRadius: 1.5,
          cursor: 'pointer',
          border: `1px solid ${clusterSel ? tokens.teal : tokens.hair}`,
          background: clusterSel ? 'rgba(31,111,107,.08)' : tokens.tile2,
          boxShadow: clusterSel ? `inset 0 0 0 1px ${tokens.teal}` : 'none',
          transition: `all .3s ${tokens.ease}`,
          '&:hover': {
            borderColor: clusterSel ? tokens.teal : '#d3c8ad',
            boxShadow: clusterSel ? `inset 0 0 0 1px ${tokens.teal}` : tokens.shadow,
          },
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: clusterSel ? tokens.teal : tokens.sub2,
            boxShadow: clusterSel ? '0 0 0 3px rgba(31,111,107,.15)' : 'none',
          }}
        />
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 15,
            color: clusterSel ? tokens.teal : tokens.ink,
          }}
        >
          {shortName(run)}
          <Box
            component="span"
            sx={{
              fontFamily: tokens.mono,
              fontSize: 11,
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
            fontFamily: tokens.mono,
            fontSize: 10.5,
            color: clusterSel ? tokens.teal : tokens.sub,
          }}
        >
          {run.topology.pools.length} pool{run.topology.pools.length > 1 ? 's' : ''} ·{' '}
          {run.gpuTotal} GPU ·{' '}
          {clusterSel ? 'selected — cluster metrics' : 'click for cluster metrics'}
        </Box>
      </Box>
      <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 1.75 }}>
        {run.topology.pools.map((pool) => {
          const poolSel =
            st.poolRole === pool.role ||
            (st.scope !== 'cluster' && !st.poolRole && w.pool === pool.role);
          const totGpus = pool.groups.reduce((a, g) => a + g.numGpus, 0);
          const totWk = pool.groups.reduce((a, g) => a + g.workers.length, 0);
          const roleColor =
            pool.role === 'attn' ? tokens.teal : pool.role === 'ffn' ? tokens.terra : tokens.sub;
          return (
            <Paper
              key={pool.role}
              onClick={() => st.selectPool(pool.role)}
              sx={{
                flex: '1 1 300px',
                minWidth: 260,
                p: '12px 13px',
                borderRadius: 1.5,
                cursor: 'pointer',
                background: poolSel ? 'rgba(31,111,107,.05)' : tokens.tile2,
                border: `1px solid ${poolSel ? tokens.teal : tokens.hair}`,
                boxShadow: poolSel ? `inset 0 0 0 1px ${tokens.teal}` : 'none',
                transition: `all .3s ${tokens.ease}`,
                '&:hover': { borderColor: poolSel ? tokens.teal : '#d3c8ad' },
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1.25 }}>
                <Typography
                  sx={{
                    fontFamily: tokens.serif,
                    fontWeight: 600,
                    fontSize: 15,
                    textTransform: 'capitalize',
                  }}
                >
                  {pool.role}
                </Typography>
                <Box
                  component="span"
                  sx={{
                    fontFamily: tokens.mono,
                    fontSize: 9.5,
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
                <Typography
                  sx={{ ml: 'auto', fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub }}
                >
                  {totWk} {totWk === 1 ? 'worker' : 'workers'} · {totGpus} GPU
                </Typography>
              </Stack>
              {pool.groups.map((gr, gi) => (
                <Box key={gi} sx={{ mb: 1.25, '&:last-child': { mb: 0 } }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                    sx={{
                      gap: 1,
                      mb: 1,
                      fontFamily: tokens.mono,
                      fontSize: 10.5,
                      color: tokens.sub,
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        color: tokens.ink,
                        fontWeight: 500,
                        px: 0.9,
                        py: '2px',
                        borderRadius: 0.75,
                        background: 'rgba(31,111,107,.08)',
                      }}
                    >
                      {gr.arch.type}
                    </Box>
                    <Box component="span">
                      {gr.replicas}×{gr.gpusPerReplica}={gr.numGpus} GPU
                    </Box>
                    {archChips(gr).map(chip)}
                  </Stack>
                  <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 1 }}>
                    {gr.workers.map((wo) => {
                      const workerKey = makeWorkerKey(pool.role, wo.id);
                      return (
                        <WorkerChip
                          key={workerKey}
                          w={wo}
                          type={gr.worker.type}
                          selected={
                            st.workerKey === workerKey &&
                            (st.scope === 'worker' ||
                              st.scope === 'kernel' ||
                              st.scope === 'parallel')
                          }
                          onClick={() => st.selectWorker(makeWorkerRef(pool.role, wo.id))}
                        />
                      );
                    })}
                  </Stack>
                </Box>
              ))}
            </Paper>
          );
        })}
      </Stack>
    </Paper>
  );
}
