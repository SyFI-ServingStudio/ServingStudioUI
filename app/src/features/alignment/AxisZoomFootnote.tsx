import { Box, Stack, Typography } from '@mui/material';

import { tokens } from '../../theme';

/**
 * The line under a zoomable board: what its axis currently shows, and the way
 * back out.
 *
 * A zoomed plot is a plot of a sub-range, and a reader who arrives at one has
 * no way to tell that from the drawing alone. So the window is stated in the
 * board's own units — the caller formats it, because only the caller knows
 * whether the axis counts milliseconds or iterations — and the control that
 * undoes it is visible rather than a gesture one has to guess.
 */
export default function AxisZoomFootnote({
  range,
  isFull,
  onReset,
}: {
  /** The window, already formatted by the page's shared formatters. */
  readonly range: string;
  readonly isFull: boolean;
  readonly onReset: () => void;
}) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'baseline',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '4px 12px',
        fontFamily: tokens.mono,
        fontSize: 9,
        color: tokens.sub2,
      }}
    >
      <Typography
        role="status"
        sx={{ fontFamily: 'inherit', fontSize: 'inherit', color: isFull ? 'inherit' : tokens.sub }}
      >
        {range}
      </Typography>
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: '10px' }}>
        <Typography sx={{ fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit' }}>
          scroll to zoom · drag to pan · <Key>+</Key> <Key>−</Key> <Key>←</Key> <Key>→</Key>
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={onReset}
          disabled={isFull}
          sx={{
            appearance: 'none',
            cursor: isFull ? 'default' : 'pointer',
            font: 'inherit',
            fontFamily: tokens.mono,
            fontSize: 9,
            p: '2px 8px',
            borderRadius: '6px',
            border: `1px solid ${isFull ? tokens.hair : tokens.teal}`,
            background: 'transparent',
            color: isFull ? tokens.sub2 : tokens.teal,
            opacity: isFull ? 0.6 : 1,
          }}
        >
          reset view
        </Box>
      </Stack>
    </Stack>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        fontFamily: tokens.mono,
        fontSize: 8.5,
        border: `1px solid ${tokens.hair}`,
        borderRadius: '4px',
        px: '3px',
        color: tokens.sub,
      }}
    >
      {children}
    </Box>
  );
}
