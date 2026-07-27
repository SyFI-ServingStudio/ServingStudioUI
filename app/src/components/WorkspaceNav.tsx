import { Box, Link, Stack } from '@mui/material';

import { tokens } from '../theme';

export default function WorkspaceNav({ current }: { current: 'run' | 'aggregate' }) {
  return (
    <Stack
      component="nav"
      aria-label="Analyzer workspace"
      direction="row"
      sx={{ border: `1px solid ${tokens.hair}`, borderRadius: 1.5, overflow: 'hidden' }}
    >
      {(
        [
          ['aggregate', '#/aggregate', 'Aggregate'],
          ['run', '#/run', 'Run'],
        ] as const
      ).map(([view, href, label], index) => (
        <Link
          key={view}
          href={href}
          underline="none"
          aria-current={current === view ? 'page' : undefined}
          sx={{
            px: 1.4,
            py: 0.7,
            fontFamily: tokens.mono,
            fontSize: 10,
            letterSpacing: '.08em',
            color: current === view ? tokens.paper : tokens.sub,
            background: current === view ? tokens.ink : tokens.tile,
            borderLeft: index === 0 ? 0 : `1px solid ${tokens.hair}`,
            transition: `color 180ms ${tokens.ease}, background 180ms ${tokens.ease}`,
            '&:hover': {
              color: current === view ? tokens.paper : tokens.ink,
              background: current === view ? tokens.ink : tokens.tile2,
            },
          }}
        >
          <Box component="span">{label}</Box>
        </Link>
      ))}
    </Stack>
  );
}
