import { Box, ButtonBase, Stack, Tooltip, Typography } from '@mui/material';

import type {
  CodexBackendId,
  CodexBackendOption,
  CodexBackendSelection,
} from '../../application/conversationRepository';
import { tokens } from '../../theme';

const ROLES = ['orchestrator', 'implementer'] as const;

type CodexRole = (typeof ROLES)[number];

type PickerSize = 'sm' | 'md';

const roleLabels: Record<CodexRole, string> = {
  orchestrator: 'Orchestrator',
  implementer: 'Implementer',
};

const sizeStyles: Record<
  PickerSize,
  { height: number; fontSize: number; labelSize: number; segmentPx: number; legendPx: number }
> = {
  sm: { height: 22, fontSize: 8, labelSize: 9.5, segmentPx: 0.95, legendPx: 0.7 },
  md: { height: 26, fontSize: 8.75, labelSize: 10.5, segmentPx: 1.25, legendPx: 0.85 },
};

function backendTitle(backend: CodexBackendOption): string {
  const model = backend.model ? backend.model : 'model unset';
  return backend.available ? model : `${model} · unavailable`;
}

/**
 * One role's backend choice as a segmented "tablet". The role name stays outside
 * the tablet so it reads as a label, never as a choice; inside are equal-width
 * segments under a single sliding ink thumb. Equal columns are what let the thumb
 * be positioned by index alone (no width measurement).
 */
function BackendSegments({
  role,
  options,
  selected,
  locked,
  size,
  onChange,
}: {
  role: CodexRole;
  options: readonly CodexBackendOption[];
  selected: CodexBackendId;
  locked: boolean;
  size: PickerSize;
  onChange: (backend: CodexBackendId) => void;
}) {
  const style = sizeStyles[size];
  const selectedIndex = Math.max(
    0,
    options.findIndex((backend) => backend.id === selected),
  );
  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{
        gap: style.legendPx,
        opacity: locked ? 0.62 : 1,
        transition: `opacity 200ms ${tokens.ease}`,
      }}
    >
      {/* The label outranks the choices: ink body type against muted mono segments. */}
      <Typography
        component="span"
        sx={{
          color: tokens.ink,
          fontSize: style.labelSize,
          fontWeight: 680,
          letterSpacing: '-.005em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {roleLabels[role]}
      </Typography>
      <Box
        role="radiogroup"
        aria-label={`${role} Codex backend`}
        sx={{
          position: 'relative',
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: '1fr',
          height: style.height,
          p: '2px',
          border: `1px solid ${tokens.hair}`,
          borderRadius: 999,
          background: 'rgba(42,38,34,.035)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: 2,
            width: `calc((100% - 4px) / ${options.length})`,
            borderRadius: 999,
            border: `1px solid ${locked ? tokens.hair : 'rgba(31,111,107,.42)'}`,
            background: locked ? 'rgba(250,247,240,.7)' : tokens.leafbg,
            boxShadow: locked ? 'none' : '0 2px 7px -5px rgba(42,38,34,.65)',
            transform: `translateX(${selectedIndex * 100}%)`,
            transition: `transform 300ms ${tokens.ease}, background 200ms ${tokens.ease}`,
          }}
        />
        {options.map((backend) => {
          const isSelected = backend.id === selected;
          const disabled = locked || !backend.available;
          return (
            <Tooltip key={backend.id} title={backendTitle(backend)} placement="top">
              <Box component="span" sx={{ display: 'flex' }}>
                <ButtonBase
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`${roleLabels[role]} backend ${backend.label}`}
                  disabled={disabled}
                  onClick={() => onChange(backend.id)}
                  sx={{
                    position: 'relative',
                    width: '100%',
                    px: style.segmentPx,
                    borderRadius: 999,
                    color: isSelected ? tokens.teal : tokens.sub2,
                    fontFamily: tokens.mono,
                    fontSize: style.fontSize,
                    fontWeight: isSelected ? 600 : 500,
                    letterSpacing: '.08em',
                    lineHeight: 1,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    transition: `color 220ms ${tokens.ease}, background 160ms ${tokens.ease}`,
                    '&:hover': {
                      background: isSelected ? 'transparent' : 'rgba(42,38,34,.05)',
                      color: isSelected ? tokens.teal : tokens.ink,
                    },
                    '&.Mui-disabled': {
                      color: isSelected ? tokens.teal : tokens.sub2,
                      opacity: backend.available ? 1 : 0.42,
                    },
                    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                  }}
                >
                  {backend.label}
                </ButtonBase>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Stack>
  );
}

/**
 * Both role tablets, shared by the entry form and the composer. Once a conversation
 * has turns the choice is fixed, which the dimmed non-interactive state carries.
 */
export default function CodexBackendPicker({
  options,
  selection,
  locked = false,
  size = 'sm',
  onChange,
}: {
  options: readonly CodexBackendOption[];
  selection: CodexBackendSelection;
  locked?: boolean;
  size?: PickerSize;
  onChange: (role: CodexRole, backend: CodexBackendId) => void;
}) {
  if (options.length === 0) return null;
  return (
    <Stack direction="row" alignItems="center" useFlexGap flexWrap="wrap" sx={{ gap: 2.8 }}>
      {ROLES.map((role) => (
        <BackendSegments
          key={role}
          role={role}
          options={options}
          selected={selection[role]}
          locked={locked}
          size={size}
          onChange={(backend) => onChange(role, backend)}
        />
      ))}
    </Stack>
  );
}

/** Backend attribution on a transcript role card — the picker's tablet, shrunk to a tag. */
export function CodexBackendTag({ backend }: { backend: CodexBackendId }) {
  const codexds = backend === 'codexds';
  const color = codexds ? tokens.violet : tokens.sub;
  return (
    <Stack
      component="span"
      direction="row"
      alignItems="center"
      sx={{
        height: 14,
        px: 0.5,
        gap: 0.4,
        border: `1px solid ${codexds ? 'rgba(101,72,220,.3)' : 'rgba(104,95,84,.25)'}`,
        borderRadius: 999,
        background: codexds ? 'rgba(101,72,220,.06)' : 'rgba(104,95,84,.05)',
      }}
    >
      <Box
        aria-hidden
        sx={{ width: 4, height: 4, borderRadius: '50%', background: color, flex: '0 0 auto' }}
      />
      <Typography
        component="span"
        sx={{
          color,
          fontFamily: tokens.mono,
          fontSize: 7.5,
          letterSpacing: '.08em',
          lineHeight: 1,
          textTransform: 'uppercase',
        }}
      >
        {codexds ? 'CodexDS' : 'Traditional'}
      </Typography>
    </Stack>
  );
}
