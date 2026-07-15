import { Box, Paper, Stack, Typography } from '@mui/material';
import { fmtInt } from '../util';
import { tokens } from '../theme';
import type { Conservation, CheckStatus } from '../domain/run';

const STY: Record<CheckStatus, { color: string; bg: string; label: string }> = {
  ok: { color: tokens.teal, bg: 'rgba(31,111,107,.10)', label: 'OK' },
  warn: { color: tokens.gold, bg: 'rgba(176,137,0,.14)', label: 'WARN' },
  fail: { color: tokens.terra, bg: 'rgba(194,92,58,.14)', label: 'FAIL' },
};

/** Workload-conservation accounting checks (cluster scope). */
export default function ConservationCard({ data, idx = 'c' }: { data: Conservation; idx?: string }) {
  return (
    <Paper sx={{ borderRadius: 2, p: '16px 18px 8px' }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.4 }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16, display: 'flex', alignItems: 'baseline', gap: 1.1 }}>
          <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 10, color: tokens.terra, letterSpacing: '.1em' }}>{idx}</Box>
          Workload conservation
        </Typography>
        <Box sx={{ fontFamily: tokens.mono, fontSize: 10.5, px: 1, py: '3px', borderRadius: 0.75, color: data.allOk ? tokens.teal : tokens.gold, background: data.allOk ? 'rgba(31,111,107,.10)' : 'rgba(176,137,0,.14)' }}>
          {data.allOk ? 'all balanced' : 'imbalance flagged'}
        </Box>
      </Stack>
      <Stack>
        {data.checks.map((c, i) => {
          const s = STY[c.status];
          return (
            <Stack key={c.name} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1.1, borderTop: i ? `1px solid ${tokens.hair}` : 'none' }}>
              <Box sx={{ width: 48, textAlign: 'center', fontFamily: tokens.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: '.06em', color: s.color, background: s.bg, borderRadius: 0.75, py: '3px' }}>{s.label}</Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.ink }}>{c.name}</Typography>
                <Typography sx={{ fontSize: 11, color: tokens.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right', minWidth: 88 }}>
                <Typography sx={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(c.actual)}</Typography>
                <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: s.color }}>{c.deltaPct > 0 ? '+' : ''}{c.deltaPct}% vs exp</Typography>
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}
