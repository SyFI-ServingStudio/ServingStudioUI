import { Box, Stack, Typography } from '@mui/material';
import { useViz, currentRun } from '../store';
import { tokens } from '../theme';
import { fmtInt } from '../util';

export default function KpiStatline() {
  const run = useViz(currentRun);
  const s = run.summary;
  const stats = [
    { fig: fmtInt(s.total_tok_s), u: 'tok/s', lab: 'Throughput', accent: true },
    { fig: String(s.num_gpus), u: '', lab: 'GPUs' },
    { fig: fmtInt(s.requests), u: '', lab: 'Requests' },
    { fig: s.ttft_p50.toFixed(0), u: 'ms', lab: 'TTFT p50' },
    { fig: s.tpot_p50.toFixed(1), u: 'ms', lab: 'TPOT p50' },
    { fig: (s.e2e_p50 / 1000).toFixed(2), u: 's', lab: 'E2E p50' },
  ];
  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: '6px 30px', alignItems: 'baseline' }}>
      {stats.map((st) => (
        <Box key={st.lab}>
          <Typography component="div" sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 'clamp(22px,2.6vw,34px)', lineHeight: 1, letterSpacing: '-.015em', color: st.accent ? tokens.teal : tokens.ink, fontVariantNumeric: 'tabular-nums' }}>
            {st.fig}
            {st.u && <Box component="span" sx={{ fontSize: '.5em', fontWeight: 500, color: tokens.sub, ml: '3px' }}>{st.u}</Box>}
          </Typography>
          <Typography sx={{ fontFamily: tokens.mono, fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: tokens.sub, mt: 0.75 }}>
            {st.lab}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}
