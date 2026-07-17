import { Box, Stack, Typography } from '@mui/material';
import SurfaceCard from '../../components/SurfaceCard';
import { fmtInt } from '../../util';
import { tokens } from '../../theme';
import type { Conservation, CheckStatus } from '../../domain/run';

const STY: Record<CheckStatus, { color: string; bg: string; label: string }> = {
  ok: { color: tokens.teal, bg: 'rgba(31,111,107,.10)', label: 'OK' },
  warn: { color: tokens.gold, bg: 'rgba(176,137,0,.14)', label: 'WARN' },
  fail: { color: tokens.terra, bg: 'rgba(194,92,58,.14)', label: 'FAIL' },
};

/** Workload-conservation accounting checks (cluster scope). */
export default function ConservationCard({
  data,
  idx = 'c',
}: {
  data: Conservation;
  idx?: string;
}) {
  return (
    <SurfaceCard
      component="section"
      aria-labelledby="workload-conservation-title"
      sx={{ p: '16px 16px 14px' }}
    >
      <Stack
        direction="row"
        alignItems="baseline"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Typography
          id="workload-conservation-title"
          component="h3"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-.01em',
            display: 'flex',
            alignItems: 'baseline',
            gap: 1.1,
          }}
        >
          <Box
            component="span"
            sx={{
              fontFamily: tokens.mono,
              fontSize: 10,
              color: tokens.terra,
              letterSpacing: '.1em',
            }}
          >
            {idx}
          </Box>
          Workload conservation
        </Typography>
        <Typography
          sx={{
            fontFamily: tokens.mono,
            fontSize: 10,
            color: data.allOk ? tokens.teal : tokens.gold,
            textAlign: 'right',
            whiteSpace: 'nowrap',
          }}
        >
          {data.allOk ? 'all balanced' : 'imbalance flagged'}
        </Typography>
      </Stack>
      <Stack>
        {data.checks.map((c, i) => {
          const s = STY[c.status];
          return (
            <Stack
              key={c.name}
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{ py: 1.1, borderTop: i ? `1px solid ${tokens.hair}` : 'none' }}
            >
              <Box
                sx={{
                  width: 48,
                  textAlign: 'center',
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: '.06em',
                  color: s.color,
                  background: s.bg,
                  borderRadius: 0.75,
                  py: '3px',
                }}
              >
                {s.label}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.ink }}>
                  {c.name}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right', minWidth: 88 }}>
                <Typography
                  sx={{
                    fontFamily: tokens.mono,
                    fontSize: 12,
                    color: tokens.ink,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtInt(c.actual)}
                </Typography>
                <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: s.color }}>
                  {c.deltaPct > 0 ? '+' : ''}
                  {c.deltaPct}% vs exp
                </Typography>
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </SurfaceCard>
  );
}
