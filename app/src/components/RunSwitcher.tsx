import { Box, Stack, Typography } from '@mui/material';
import { RUNS } from '../data/fakeData';
import { useViz } from '../store';
import { tokens } from '../theme';
import { shortName } from '../util';

export default function RunSwitcher() {
  const runIx = useViz((s) => s.runIx);
  const setRun = useViz((s) => s.setRun);
  return (
    <Stack spacing={1} sx={{ minWidth: 270 }}>
      <Typography sx={{ fontFamily: tokens.mono, fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: tokens.sub }}>
        Simulated run
      </Typography>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {RUNS.map((r, i) => {
          const active = i === runIx;
          return (
            <Box
              key={r.id}
              onClick={() => setRun(i)}
              sx={{
                cursor: 'pointer', fontFamily: tokens.body, fontWeight: 600, fontSize: 12.5,
                px: 1.75, py: 1, borderRadius: 999, whiteSpace: 'nowrap',
                transition: `all .3s ${tokens.ease}`,
                border: `1px solid ${active ? tokens.ink : tokens.hair}`,
                background: active ? tokens.ink : tokens.tile,
                color: active ? tokens.paper : tokens.sub,
                boxShadow: active ? tokens.shadow : 'none',
                '&:hover': { borderColor: tokens.teal, color: active ? tokens.paper : tokens.ink, transform: 'translateY(-1px)' },
              }}
            >
              {shortName(r)}
              <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 9.5, opacity: 0.7, ml: 0.9 }}>
                {r.deployment.toUpperCase()}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}
