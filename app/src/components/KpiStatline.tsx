import { Box, Stack, Typography } from '@mui/material';
import { useActiveRunData } from '../application/ActiveRunProvider';
import { subjectStatusMessage } from '../application/subjectStatus';
import { tokens } from '../theme';
import { fmtInt } from '../util';

export default function KpiStatline() {
  const { run, subjects } = useActiveRunData();
  const s = run.summary;
  const slo = subjects.slo.status === 'ready' ? subjects.slo.payload : null;
  const stats = [
    { fig: fmtInt(s.total_tok_s), u: 'tok/s', lab: 'Throughput', accent: true },
    { fig: String(s.num_gpus), u: '', lab: 'GPUs' },
    { fig: fmtInt(s.requests), u: '', lab: 'Requests' },
    { fig: slo ? slo.ttft.markers.p50.toFixed(0) : '—', u: slo ? 'ms' : '', lab: 'TTFT p50' },
    { fig: slo ? slo.tpot.markers.p50.toFixed(1) : '—', u: slo ? 'ms' : '', lab: 'TPOT p50' },
    {
      fig: slo ? (slo.e2e.markers.p50 / 1000).toFixed(2) : '—',
      u: slo ? 's' : '',
      lab: 'E2E p50',
    },
  ];
  return (
    <Box>
      <Stack
        direction="row"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: '6px 30px', alignItems: 'baseline' }}
      >
        {stats.map((st) => (
          <Box key={st.lab}>
            <Typography
              component="div"
              sx={{
                fontFamily: tokens.serif,
                fontWeight: 600,
                fontSize: 'clamp(22px,2.6vw,34px)',
                lineHeight: 1,
                letterSpacing: '-.015em',
                color: st.accent ? tokens.teal : tokens.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {st.fig}
              {st.u && (
                <Box
                  component="span"
                  sx={{ fontSize: '.5em', fontWeight: 500, color: tokens.sub, ml: '3px' }}
                >
                  {st.u}
                </Box>
              )}
            </Typography>
            <Typography
              sx={{
                fontFamily: tokens.mono,
                fontSize: 10,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: tokens.sub,
                mt: 0.75,
              }}
            >
              {st.lab}
            </Typography>
          </Box>
        ))}
      </Stack>
      {subjects.slo.status !== 'ready' && (
        <Typography
          role="status"
          sx={{ mt: 1, fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}
        >
          Latency KPIs unavailable · {subjectStatusMessage(subjects.slo)}
        </Typography>
      )}
    </Box>
  );
}
