import { Box, ButtonBase, Stack, Typography } from '@mui/material';

import { tokens, withAlpha } from '../../ui/theme';
import { AUTONOMY_CAPTIONS, CAST_CAPTIONS, agentSettingsSentence } from './agentMode';
import type { AgentMode, AgentSettings } from './agentTypes';

/**
 * The conversation's working style, as four plates: each names its whole
 * combination, so nothing has to be read off an axis.
 *
 * An earlier draft was a 2x2 mark grid with the cast down the left and the
 * autonomy across the top. It was correct but weightless — it read as a
 * settings row borrowed from the composer header, which is the wrong thing to
 * open a page with, and on a phone it forced the axis labels down to a size
 * nobody reads.
 *
 * Dropping the axes costs the *visible* orthogonality, so the glyph row carries
 * it instead: the cast figure repeats down each column, the autonomy rule
 * repeats across each row. A reader who never notices this still gets four
 * fully-named choices; one who does gets the two axes back for free.
 */

/** Ordered so the grid reads 2x2: cast down the columns, autonomy across. */
const PLATES: readonly { agentMode: AgentMode; autonomous: boolean }[] = [
  { agentMode: 'orchestrated', autonomous: false },
  { agentMode: 'orchestrated', autonomous: true },
  { agentMode: 'single', autonomous: false },
  { agentMode: 'single', autonomous: true },
];

/**
 * Two silhouettes or one, drawn on a shared baseline so the pair does not read
 * as heavier ink than the single.
 */
function CastGlyph({ agentMode }: { agentMode: AgentMode }) {
  return (
    <Box
      component="svg"
      aria-hidden
      viewBox="0 0 30 19"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      sx={{ width: 30, height: 19, flex: 'none' }}
    >
      {agentMode === 'single' ? (
        <>
          <circle cx="15" cy="6.2" r="4.2" />
          <path d="M8.6 17.6c0-3.5 2.9-5.7 6.4-5.7s6.4 2.2 6.4 5.7" />
        </>
      ) : (
        <>
          <circle cx="8" cy="6.5" r="3.8" />
          <path d="M2.4 17.6c0-3.2 2.5-5.2 5.6-5.2s5.6 2 5.6 5.2" />
          <circle cx="22" cy="6.5" r="3.8" />
          <path d="M16.4 17.6c0-3.2 2.5-5.2 5.6-5.2s5.6 2 5.6 5.2" />
        </>
      )}
    </Box>
  );
}

/** A rule that pauses at a dot, or one that runs to an arrow. */
function AutonomyGlyph({ autonomous }: { autonomous: boolean }) {
  return (
    <Box
      component="svg"
      aria-hidden
      viewBox="0 0 34 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: 34, height: 10, flex: 'none' }}
    >
      {autonomous ? (
        <>
          <path d="M1 5h29" />
          <path d="M26.5 1.6L30.2 5l-3.7 3.4" />
        </>
      ) : (
        <>
          <path d="M1 5h11" strokeDasharray="2.4 2.6" />
          <circle cx="17" cy="5" r="2.6" fill="currentColor" stroke="none" />
          <path d="M22 5h11" strokeDasharray="2.4 2.6" />
        </>
      )}
    </Box>
  );
}

/**
 * One axis of the settled style, as a pill for the composer band.
 *
 * Deliberately built from `CodexRuntimeTag`'s vocabulary — same height, same
 * mono size, same dot — so the band reads as one instrument rather than as
 * unrelated controls that happen to be adjacent. Teal rather than the chips'
 * neutral, because these two are settled for the whole conversation and the
 * chips are not.
 *
 * One axis per pill, and the two sit at opposite ends of the band: they are
 * independent, and a single joined pill kept reading as one compound setting.
 * The words shorten to their axis alone (`multi`/`single`, `human`/`auto`) —
 * at this size the full captions are for the plates, which are still one
 * scroll away in an empty conversation.
 */
export function WorkingStyleTag({
  axis,
  settings,
}: {
  axis: 'cast' | 'autonomy';
  settings: AgentSettings;
}) {
  const label =
    axis === 'cast'
      ? settings.agentMode === 'single'
        ? 'single'
        : 'multi'
      : settings.autonomous
        ? 'auto'
        : 'human';
  return (
    <Stack
      component="span"
      direction="row"
      alignItems="center"
      sx={{
        flex: '0 0 auto',
        height: 14,
        px: 0.5,
        gap: 0.4,
        border: `1px solid ${tokens.hair}`,
        borderRadius: 999,
        background: tokens.tile,
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 4,
          height: 4,
          borderRadius: '50%',
          background: tokens.sub2,
          flex: '0 0 auto',
        }}
      />
      <Typography
        component="span"
        sx={{
          color: tokens.sub,
          fontFamily: tokens.body,
          fontSize: 10,
          letterSpacing: 0,
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>
    </Stack>
  );
}

export default function AgentModePicker({
  settings,
  locked,
  disabled = false,
  size = 'sm',
  onChange,
}: {
  settings: AgentSettings;
  /** The first message pins both axes server-side; then only the sentence shows. */
  locked: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  onChange: (settings: AgentSettings) => void;
}) {
  const sentence = agentSettingsSentence(settings);
  if (locked) {
    return (
      <Typography
        sx={{
          color: tokens.sub,
          fontSize: size === 'md' ? 14 : 12.5,
          letterSpacing: '-.005em',
          textAlign: 'center',
        }}
      >
        <Box component="strong" sx={{ color: tokens.ink, fontWeight: 650 }}>
          {sentence.cast}
        </Box>
        {` · ${sentence.autonomy}`}
      </Typography>
    );
  }
  return (
    <Box
      role="radiogroup"
      aria-label="Agent working style"
      sx={{
        display: 'grid',
        // One column below 420px: each plate keeps its full combination, so the
        // stack stays readable without an axis to refer back to. This is the
        // reason the plates beat a grid on a phone.
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: size === 'md' ? 1.25 : 1,
        width: '100%',
        maxWidth: size === 'md' ? 452 : 400,
        opacity: disabled ? 0.45 : 1,
        transition: `opacity 160ms ${tokens.ease}`,
      }}
    >
      {PLATES.map((plate) => (
        <Plate
          key={`${plate.agentMode}-${plate.autonomous}`}
          agentMode={plate.agentMode}
          autonomous={plate.autonomous}
          selected={
            plate.agentMode === settings.agentMode && plate.autonomous === settings.autonomous
          }
          disabled={disabled}
          size={size}
          onSelect={() => onChange({ agentMode: plate.agentMode, autonomous: plate.autonomous })}
        />
      ))}
    </Box>
  );
}

function Plate({
  agentMode,
  autonomous,
  selected,
  disabled,
  size,
  onSelect,
}: {
  agentMode: AgentMode;
  autonomous: boolean;
  selected: boolean;
  disabled: boolean;
  size: 'sm' | 'md';
  onSelect: () => void;
}) {
  const cast = CAST_CAPTIONS[agentMode];
  const autonomy = autonomous ? AUTONOMY_CAPTIONS.autonomous : AUTONOMY_CAPTIONS.supervised;
  return (
    <ButtonBase
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${cast}, ${autonomy}`}
      disabled={disabled}
      onClick={onSelect}
      sx={{
        position: 'relative',
        display: 'block',
        overflow: 'hidden',
        px: size === 'md' ? 1.85 : 1.5,
        pt: size === 'md' ? 1.95 : 1.6,
        pb: size === 'md' ? 1.7 : 1.4,
        borderRadius: '11px',
        border: `1px solid ${selected ? withAlpha(tokens.teal, 0.35) : tokens.hair}`,
        background: selected ? withAlpha(tokens.teal, 0.075) : tokens.leafbg,
        boxShadow: selected ? `0 8px 22px -14px ${withAlpha(tokens.teal, 0.65)}` : 'none',
        textAlign: 'left',
        transition: `border-color 200ms ${tokens.ease}, background 200ms ${tokens.ease}, box-shadow 200ms ${tokens.ease}`,
        // The lit edge: a rule down the left, so a chosen plate still reads as
        // marked where the wash is too faint to survive a projector.
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: selected ? tokens.teal : 'transparent',
          transition: `background 200ms ${tokens.ease}`,
        },
        '&:hover': { borderColor: selected ? withAlpha(tokens.teal, 0.35) : tokens.sub2 },
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.25,
          height: 22,
          mb: 1.35,
          color: selected ? tokens.teal : tokens.sub2,
          transition: `color 200ms ${tokens.ease}`,
        }}
      >
        <CastGlyph agentMode={agentMode} />
        <AutonomyGlyph autonomous={autonomous} />
      </Box>
      <Typography
        sx={{
          color: tokens.ink,
          fontFamily: tokens.serif,
          fontSize: size === 'md' ? 15.5 : 14.5,
          fontWeight: 600,
          letterSpacing: '-.012em',
          lineHeight: 1.2,
        }}
      >
        {cast}
      </Typography>
      <Typography sx={{ mt: 0.5, color: tokens.sub, fontSize: 12, lineHeight: 1.35 }}>
        {autonomy}
      </Typography>
    </ButtonBase>
  );
}
