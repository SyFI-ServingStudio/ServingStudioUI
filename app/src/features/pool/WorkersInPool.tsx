import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material';
import { useViz } from '../../store';
import { useActiveRun } from '../../application/ActiveRunProvider';
import { tokens } from '../../theme';

/** Compact drill affordance at pool scope: the pool's workers, click to descend. */
export default function WorkersInPool({ role, idx = 'd' }: { role: string; idx?: string }) {
  const selectWorker = useViz((state) => state.selectWorker);
  const run = useActiveRun();
  const workers = run.workerList.filter((w) => w.pool === role);

  return (
    <Paper sx={{ borderRadius: 2, p: '16px 18px' }}>
      <Stack direction="row" alignItems="baseline" sx={{ mb: 1.3, gap: 1.1 }}>
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 16,
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
          Workers in{' '}
          <Box component="span" sx={{ textTransform: 'capitalize' }}>
            {role}
          </Box>
        </Typography>
        <Box
          component="span"
          sx={{ ml: 'auto', fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub }}
        >
          {workers.length} · drill into a worker →
        </Box>
      </Stack>
      <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 1.25 }}>
        {workers.map((w) => (
          <ButtonBase
            key={w.key}
            type="button"
            aria-label={`Scope to worker ${w.ref.poolTag}/${w.ref.workerId}`}
            onClick={() => selectWorker(w.ref)}
            sx={{
              display: 'block',
              textAlign: 'left',
              cursor: 'pointer',
              p: '10px 14px',
              borderRadius: 1.25,
              border: `1px solid ${tokens.hair}`,
              background: tokens.tile2,
              transition: `all .24s ${tokens.ease}`,
              '&:hover': {
                transform: 'translateY(-2px)',
                borderColor: tokens.teal,
                boxShadow: tokens.shadow,
              },
            }}
          >
            <Typography
              sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 14, color: tokens.teal }}
            >
              {w.id}
            </Typography>
            <Typography sx={{ fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
              {w.archType} · {w.gpuCount} GPU{w.dp ? ` · dp${w.dp}` : ''}
            </Typography>
          </ButtonBase>
        ))}
      </Stack>
    </Paper>
  );
}
