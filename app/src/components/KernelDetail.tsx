import { Box, IconButton, Paper, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useViz } from '../store';
import { currentWorker, workerTree } from '../application/runSelection';
import { useActiveRun } from '../application/ActiveRunProvider';
import { leafById, kindLabel, colorOf, fmtMs, fmtPct } from '../data/tree';
import { kernelPerf } from '../data/kernel';
import { tokens } from '../theme';

function Item({ k, v, big, teal }: { k: string; v: string; big?: boolean; teal?: boolean }) {
  return (
    <Box
      sx={{
        p: '12px 18px',
        borderTop: `1px solid ${tokens.hair}`,
        borderRight: `1px solid ${tokens.hair}`,
        '&:last-of-type': { borderRight: 'none' },
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.mono,
          fontSize: 9.5,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: tokens.sub,
          mb: 0.6,
        }}
      >
        {k}
      </Typography>
      <Typography
        sx={{
          fontFamily: big ? tokens.serif : tokens.mono,
          fontSize: big ? 22 : 12.5,
          fontWeight: big ? 600 : 400,
          color: teal ? tokens.teal : tokens.ink,
          wordBreak: 'break-word',
        }}
      >
        {v}
      </Typography>
    </Box>
  );
}

export default function KernelDetail() {
  const st = useViz();
  const run = useActiveRun();
  const w = currentWorker(run, st);
  if (st.scope !== 'kernel' || st.leafId == null) return null;
  const node = leafById(workerTree(run, st), st.leafId);
  if (!node) return null;
  const s = node.slot!;
  const color = colorOf(s.kind);
  const perf = kernelPerf(node);
  const util = Math.round(Math.max(perf.computeUtil, perf.memUtil) * 100);

  return (
    <Paper sx={{ borderRadius: 2, overflow: 'hidden', background: tokens.tile2 }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{
          gap: 1.5,
          p: '15px 18px',
          borderBottom: `1px solid ${tokens.hair}`,
          background: 'linear-gradient(180deg, rgba(31,111,107,.06), transparent)',
        }}
      >
        <Typography
          sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 22, letterSpacing: '-.015em' }}
        >
          {s.name.split('.').pop()}
        </Typography>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            fontFamily: tokens.mono,
            fontSize: 10.5,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            px: 1.1,
            py: 0.4,
            borderRadius: 0.75,
            color,
            background: `${color}22`,
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '2px', background: color }} />
          {kindLabel(s.kind)}
        </Box>
        <IconButton
          size="small"
          onClick={() => st.selectWorker(w.ref)}
          sx={{
            ml: 'auto',
            color: tokens.sub,
            '&:hover': { color: '#fff', background: tokens.terra },
          }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}
      >
        <Item k="cost / call" v={fmtMs(node.ms)} big teal />
        <Item k="share of iter" v={fmtPct(node.pct)} big />
        <Item k="achieved" v={`${perf.tflops} TF/s`} big />
        <Item k="bandwidth" v={`${perf.gbps} GB/s`} big />
        <Item k="slot" v={s.name} />
        <Item k="backend" v={s.backend || 'default'} />
        <Item k="config" v={s.config || '—'} />
        <Item k="roofline" v={`${perf.boundedBy}-bound · ${util}% peak`} teal />
      </Box>
    </Paper>
  );
}
