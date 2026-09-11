import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import { tokens } from '../../ui/theme';

/**
 * One step of Page 0's three-step opening: working style, workspace, question.
 *
 * A step is open or folded. Folded, it is a single line carrying its own answer
 * and nothing else; the line is a button, so a reader can reopen any step
 * without losing what was decided after it.
 *
 * Both states animate through `Collapse`, which transitions real height. An
 * earlier pass faded and slid the incoming panel while its height snapped, and
 * the snap is what read as abrupt — the eye tracks the block edges below far
 * more than it tracks the panel itself. Opening runs slower than folding
 * because the opening panel is the thing being read, while the fold is just
 * getting out of the way.
 *
 * `appear` matters as much as the durations: a step is mounted only once it
 * becomes reachable, and without it `Collapse` skips the transition on first
 * mount, so the new step popped in at full height while the one above was still
 * folding. That collision is what read as a blink.
 */

const FOLD_MS = 260;
const OPEN_MS = 380;

/**
 * The caption column is fixed so every step's answer starts at the same x.
 * `Working style` is wider than `Workspace`, and letting the captions size
 * themselves left the folded summaries visibly ragged down the page.
 */
const CAPTION_COLUMN = { xs: 96, sm: 120 };

export default function SetupStep({
  index,
  label,
  summary,
  open,
  onReopen,
  children,
}: {
  /** 1-based; shown in the marker and read out in the reopen label. */
  index: number;
  label: string;
  /** The answer, shown once folded. Absent means the step has no answer yet. */
  summary?: ReactNode;
  open: boolean;
  onReopen: () => void;
  children: ReactNode;
}) {
  return (
    <Box>
      <Collapse
        appear
        in={open}
        timeout={{ appear: OPEN_MS, enter: OPEN_MS, exit: FOLD_MS }}
        easing={tokens.ease}
      >
        <Box
          sx={{
            p: { xs: '17px 14px 15px', sm: '20px 18px 18px' },
            border: `1px solid ${tokens.hair}`,
            borderRadius: '11px',
            background: tokens.tile,
          }}
        >
          {/* Same column track as the folded line, so the marker and caption do
              not shift sideways when a step opens or closes. */}
          <Box sx={{ ...rowGrid, mb: 2 }}>
            <StepMarker index={index} filled={false} />
            <Typography noWrap sx={captionStyle}>
              {label}
            </Typography>
            <Box />
            <Box />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>{children}</Box>
        </Box>
      </Collapse>
      <Collapse
        appear
        in={!open}
        timeout={{ appear: OPEN_MS, enter: OPEN_MS, exit: FOLD_MS }}
        easing={tokens.ease}
      >
        <ButtonBase
          onClick={onReopen}
          aria-label={`Change step ${index}, ${label}`}
          sx={{
            ...rowGrid,
            width: '100%',
            px: 1.75,
            py: 1.35,
            border: `1px solid ${tokens.hair}`,
            borderRadius: '9px',
            background: tokens.tile,
            textAlign: 'left',
            transition: `border-color 170ms ${tokens.ease}`,
            '&:hover': { borderColor: tokens.sub2 },
            '&:hover .setup-step-change': { color: tokens.ink },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
          }}
        >
          <StepMarker index={index} filled />
          <Typography noWrap sx={captionStyle}>
            {label}
          </Typography>
          <Typography
            noWrap
            sx={{ minWidth: 0, color: tokens.ink, fontFamily: tokens.serif, fontSize: 14.5 }}
          >
            {summary}
          </Typography>
          <Typography className="setup-step-change" sx={{ ...captionStyle, color: tokens.teal }}>
            Change
          </Typography>
        </ButtonBase>
      </Collapse>
    </Box>
  );
}

/** marker · caption · answer · trailing note — shared by both states. */
const rowGrid = {
  display: 'grid',
  gridTemplateColumns: `19px ${CAPTION_COLUMN.xs}px minmax(0, 1fr) auto`,
  alignItems: 'center',
  columnGap: 1.5,
  '@media (min-width:600px)': {
    gridTemplateColumns: `19px ${CAPTION_COLUMN.sm}px minmax(0, 1fr) auto`,
  },
} as const;

const captionStyle = {
  color: tokens.sub2,
  fontFamily: tokens.body,
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '.02em',
  lineHeight: 1.35,
  textTransform: 'none',
} as const;

/** Filled once the step is answered, hollow while it is the one being asked. */
function StepMarker({ index, filled }: { index: number; filled: boolean }) {
  return (
    <Box
      aria-hidden
      sx={{
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        width: 19,
        height: 19,
        borderRadius: '50%',
        border: `1px solid ${tokens.teal}`,
        background: filled ? tokens.teal : 'transparent',
        color: filled ? tokens.tile : tokens.teal,
        fontFamily: tokens.body,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {index}
    </Box>
  );
}
