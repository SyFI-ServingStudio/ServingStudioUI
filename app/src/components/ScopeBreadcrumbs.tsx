import { Box, Stack, Typography } from '@mui/material';
import { useViz, currentRun, currentWorker, workerTree } from '../store';
import { leafById, nodeById } from '../data/tree';
import { tokens } from '../theme';
import { shortName } from '../util';

interface Crumb { g: string; lab: string; here: boolean; onClick?: () => void; }

export default function ScopeBreadcrumbs() {
  const st = useViz();
  const run = currentRun(st);
  const w = currentWorker(st);

  const parts: Crumb[] = [{ g: '▸', lab: shortName(run), here: st.scope === 'cluster', onClick: () => st.setCluster() }];
  if (st.scope !== 'cluster') {
    const role = st.poolRole ?? w.pool;
    parts.push({ g: 'pool', lab: role, here: st.scope === 'pool', onClick: () => st.selectPool(role) });
  }
  if (st.scope === 'worker' || st.scope === 'kernel' || st.scope === 'parallel') {
    parts.push({ g: 'worker', lab: w.id, here: st.scope === 'worker', onClick: () => st.selectWorker(w.key) });
  }
  if (st.scope === 'kernel') {
    const lf = leafById(workerTree(st), st.leafId);
    parts.push({ g: 'kernel', lab: lf ? lf.slot!.name.split('.').pop()! : '—', here: true });
  }
  if (st.scope === 'parallel') {
    const pn = nodeById(workerTree(st), st.parId);
    parts.push({ g: 'parallel', lab: pn ? (pn.label ?? 'max') : '—', here: true });
  }

  const hint: Record<string, string> = {
    cluster: 'cluster — SLO · throughput · conservation',
    pool: 'pool — utilization · KV · batch composition',
    worker: run.capabilities.workerIterations
      ? 'worker — batch composition · cost tree · kernel throughput'
      : 'worker — full-run aggregate kernel time share',
    kernel: run.capabilities.kernelPerformance ? 'kernel — roofline · input distribution' : 'kernel — detail not generated',
    parallel: run.capabilities.loadImbalance ? 'parallel — load imbalance · straggler' : 'parallel — detail not generated',
  };

  return (
    <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 1.1, my: 2.2 }}>
      {parts.map((p, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={1.1}>
          {i > 0 && <Box component="span" sx={{ color: tokens.sub, opacity: 0.5, fontFamily: tokens.serif, fontStyle: 'italic' }}>/</Box>}
          <Box
            onClick={p.here ? undefined : p.onClick}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.9, px: 1.5, py: 0.6, borderRadius: 1.75,
              fontSize: 12.5, fontWeight: 600, cursor: p.here ? 'default' : 'pointer',
              border: `1px solid ${p.here ? tokens.hair : 'transparent'}`,
              color: p.here ? tokens.ink : tokens.sub,
              background: p.here ? tokens.tile : 'transparent',
              boxShadow: p.here ? tokens.shadow : 'none',
              transition: `all .28s ${tokens.ease}`,
              '&:hover': p.here ? {} : { color: tokens.ink, background: 'rgba(42,38,34,.04)' },
            }}
          >
            <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 11, opacity: 0.7 }}>{p.g}</Box>
            {p.lab}
          </Box>
        </Stack>
      ))}
      <Typography sx={{ ml: 'auto', fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub2, letterSpacing: '.04em' }}>
        {hint[st.scope]}
      </Typography>
    </Stack>
  );
}
