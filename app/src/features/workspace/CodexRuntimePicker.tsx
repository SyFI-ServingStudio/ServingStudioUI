import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { Box, ButtonBase, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { Fragment, useMemo, useState } from 'react';

import type {
  CodexModelOption,
  CodexRoleRuntime,
  CodexRuntimeSelection,
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
  { height: number; fontSize: number; labelSize: number; gap: number }
> = {
  sm: { height: 22, fontSize: 8.5, labelSize: 9.5, gap: 0.7 },
  md: { height: 26, fontSize: 9.5, labelSize: 10.5, gap: 0.85 },
};

/**
 * `GPT-5.6-Sol` / `DeepSeek V4 Flash` read better than the raw slug once the
 * family is already shown. Drops the catalog's provider parenthetical and the
 * checkpoint date; the exact slug still shows under the model card.
 */
function shortModelLabel(model: CodexModelOption | undefined, fallback: string): string {
  if (!model) return fallback || 'unset';
  const [, tail] = model.label.split(' (');
  const withoutProvider = tail
    ? model.label.slice(0, model.label.length - tail.length - 2)
    : model.label;
  return withoutProvider.replace(/\s+\d{4,}$/, '');
}

/**
 * One shared effort ladder for the grid header. Each model lists its own levels
 * in ascending order but skips some (Luna has no `ultra`, DeepSeek starts at
 * `high`), so the columns are an order-preserving merge rather than a fixed
 * table: a level a model does not offer simply leaves its cell empty.
 */
function effortColumns(models: readonly CodexModelOption[]): string[] {
  const merged: string[] = [];
  for (const model of models) {
    let cursor = 0;
    for (const level of model.efforts) {
      const seen = merged.indexOf(level);
      if (seen === -1) {
        merged.splice(cursor, 0, level);
        cursor += 1;
      } else {
        cursor = seen + 1;
      }
    }
  }
  return merged;
}

const CELL_HEIGHT = 24;

/** Trail segments run from the model name up to the pick, then stop. */
const TRAIL_TINT = 'rgba(31,111,107,.055)';

/** One model × effort cell: a dot that swells and rings when it is the pick. */
function RuntimeCell({
  model,
  effort,
  selected,
  trail,
  locked,
  onSelect,
}: {
  model: CodexModelOption;
  effort: string;
  selected: boolean;
  trail: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  // The trail has to cross levels this model skips, or it would break apart.
  const trailRadius = selected ? '0 7px 7px 0' : 0;
  if (!model.efforts.includes(effort)) {
    return (
      <Box
        aria-hidden
        sx={{
          height: CELL_HEIGHT,
          borderRadius: trailRadius,
          background: trail ? TRAIL_TINT : 'transparent',
        }}
      />
    );
  }
  const disabled = locked || !model.available;
  return (
    <ButtonBase
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${shortModelLabel(model, model.id)} at ${effort}`}
      disabled={disabled}
      onClick={onSelect}
      sx={{
        height: CELL_HEIGHT,
        borderRadius: trail ? trailRadius : 0.8,
        // The trail reads left to right as "this model, up to this level", so a
        // lone dot resolves to a (model, effort) pair without ruling the grid.
        background: trail ? TRAIL_TINT : 'transparent',
        transition: `background 180ms ${tokens.ease}`,
        '&:hover .runtime-dot': {
          width: selected ? 11 : 7,
          height: selected ? 11 : 7,
          background: tokens.teal,
        },
        '&.Mui-disabled': { opacity: 0.32 },
        '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
      }}
    >
      <Box
        className="runtime-dot"
        sx={{
          width: selected ? 11 : 4.5,
          height: selected ? 11 : 4.5,
          borderRadius: '50%',
          background: selected ? tokens.teal : 'rgba(42,38,34,.22)',
          boxShadow: selected ? '0 0 0 3.5px rgba(31,111,107,.13)' : 'none',
          transition: `all 240ms ${tokens.ease}`,
        }}
      />
    </ButtonBase>
  );
}

function RuntimePanel({
  role,
  models,
  runtime,
  lockedFamily,
  disabled,
  onChange,
}: {
  role: CodexRole;
  models: readonly CodexModelOption[];
  runtime: CodexRoleRuntime;
  lockedFamily: string | null;
  disabled: boolean;
  onChange: (runtime: CodexRoleRuntime) => void;
}) {
  const families = useMemo(() => {
    const grouped = new Map<string, { label: string; models: CodexModelOption[] }>();
    for (const model of models) {
      const group = grouped.get(model.family) ?? { label: model.familyLabel, models: [] };
      group.models.push(model);
      grouped.set(model.family, group);
    }
    return [...grouped.entries()];
  }, [models]);
  const efforts = useMemo(() => effortColumns(models), [models]);
  const selectedModel = models.find((model) => model.id === runtime.model);
  const fastAvailable = selectedModel?.serviceTiers?.includes('fast') ?? false;
  return (
    <Box sx={{ p: 1.4, pt: 1.2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 2 }}>
        <Typography
          sx={{
            color: tokens.sub2,
            fontFamily: tokens.mono,
            fontSize: 8.5,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
          }}
        >
          {roleLabels[role]} runtime
        </Typography>
        <Tooltip
          title={
            disabled
              ? 'Speed can be changed after the active turn finishes.'
              : fastAvailable
                ? 'Fast uses the provider priority service tier.'
                : 'This model does not offer the Fast service tier.'
          }
          placement="top"
        >
          <Box
            role="group"
            aria-label={`${roleLabels[role]} speed tier`}
            sx={{
              display: 'inline-grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              p: '2px',
              border: `1px solid ${tokens.hair}`,
              borderRadius: 999,
              background: tokens.leafbg,
            }}
          >
            {(['default', 'fast'] as const).map((serviceTier) => {
              const selected = runtime.serviceTier === serviceTier;
              const unavailable = disabled || (serviceTier === 'fast' && !fastAvailable);
              return (
                <ButtonBase
                  key={serviceTier}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${roleLabels[role]} ${serviceTier === 'fast' ? 'Fast' : 'Normal'} tier`}
                  disabled={unavailable}
                  onClick={() => onChange({ ...runtime, serviceTier })}
                  sx={{
                    minWidth: 48,
                    height: 19,
                    px: 0.8,
                    borderRadius: 999,
                    background: selected ? tokens.tile : 'transparent',
                    color: selected ? tokens.teal : tokens.sub2,
                    boxShadow: selected ? '0 1px 4px rgba(42,38,34,.12)' : 'none',
                    fontFamily: tokens.mono,
                    fontSize: 7.5,
                    fontWeight: selected ? 700 : 550,
                    letterSpacing: '.055em',
                    textTransform: 'uppercase',
                    transition: `background 160ms ${tokens.ease}, color 160ms ${tokens.ease}, box-shadow 160ms ${tokens.ease}`,
                    '&.Mui-disabled': { color: tokens.sub2, opacity: 0.42 },
                    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                  }}
                >
                  {serviceTier === 'fast' ? 'Fast' : 'Normal'}
                </ButtonBase>
              );
            })}
          </Box>
        </Tooltip>
      </Stack>
      <Box
        role="radiogroup"
        aria-label={`${roleLabels[role]} model and reasoning effort`}
        sx={{
          mt: 0.9,
          display: 'grid',
          gridTemplateColumns: `minmax(120px, 1fr) repeat(${efforts.length}, 34px)`,
          alignItems: 'center',
        }}
      >
        <Box aria-hidden />
        {efforts.map((effort) => (
          <Typography
            key={effort}
            aria-hidden
            sx={{
              pb: 0.5,
              color: effort === runtime.effort ? tokens.teal : tokens.sub2,
              fontFamily: tokens.mono,
              fontSize: 7.5,
              fontWeight: effort === runtime.effort ? 650 : 500,
              letterSpacing: '.05em',
              lineHeight: 1,
              textAlign: 'center',
              textTransform: 'uppercase',
              transition: `color 200ms ${tokens.ease}`,
            }}
          >
            {effort}
          </Typography>
        ))}
        {families.map(([familyId, group], groupIndex) => {
          const familyLocked = lockedFamily !== null && lockedFamily !== familyId;
          const cellDisabled = disabled || familyLocked;
          return (
            <Fragment key={familyId}>
              <Stack
                aria-hidden
                direction="row"
                alignItems="center"
                sx={{ gridColumn: '1 / -1', mt: groupIndex === 0 ? 0 : 1, mb: 0.4, gap: 0.6 }}
              >
                <Typography
                  sx={{
                    color: tokens.sub2,
                    fontSize: 8.5,
                    fontWeight: 620,
                    letterSpacing: '.06em',
                    lineHeight: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  {group.label}
                </Typography>
                {familyLocked && <LockOutlined sx={{ color: tokens.sub2, fontSize: 10 }} />}
                <Box sx={{ flex: 1, borderTop: `1px solid ${tokens.hair}` }} />
              </Stack>
              {group.models.map((model) => {
                const onRow = model.id === runtime.model;
                const pickedIndex = onRow ? efforts.indexOf(runtime.effort) : -1;
                return (
                  <Fragment key={model.id}>
                    <Tooltip title={model.id} placement="left">
                      <Typography
                        noWrap
                        sx={{
                          pr: 1,
                          pl: 0.4,
                          height: CELL_HEIGHT,
                          display: 'flex',
                          alignItems: 'center',
                          borderRadius: onRow ? '7px 0 0 7px' : 0.8,
                          background: onRow ? TRAIL_TINT : 'transparent',
                          color: onRow ? tokens.teal : familyLocked ? tokens.sub2 : tokens.ink,
                          fontSize: 10,
                          fontWeight: onRow ? 650 : 520,
                          opacity: cellDisabled || !model.available ? 0.45 : 1,
                          transition: `color 200ms ${tokens.ease}, background 180ms ${tokens.ease}`,
                        }}
                      >
                        {shortModelLabel(model, model.id)}
                      </Typography>
                    </Tooltip>
                    {efforts.map((effort, effortIndex) => (
                      <RuntimeCell
                        key={effort}
                        model={model}
                        effort={effort}
                        selected={onRow && effort === runtime.effort}
                        trail={onRow && effortIndex <= pickedIndex}
                        locked={cellDisabled}
                        onSelect={() =>
                          onChange({
                            model: model.id,
                            effort,
                            serviceTier: model.serviceTiers?.includes(runtime.serviceTier)
                              ? runtime.serviceTier
                              : model.defaultServiceTier,
                          })
                        }
                      />
                    ))}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </Box>
      {lockedFamily !== null && (
        // Kept to one short line: a wrapping paragraph would widen the panel,
        // and the locked family already carries its own padlock above.
        <Tooltip
          title="A Codex session can only be resumed by the family that recorded it. Sibling models and every effort level stay open."
          placement="bottom"
        >
          <Stack
            direction="row"
            alignItems="center"
            sx={{ mt: 1.2, gap: 0.5, width: 'fit-content' }}
          >
            <LockOutlined aria-hidden sx={{ color: tokens.sub2, fontSize: 10 }} />
            <Typography noWrap sx={{ color: tokens.sub2, fontSize: 9, lineHeight: 1 }}>
              Family locked once the conversation starts
            </Typography>
          </Stack>
        </Tooltip>
      )}
    </Box>
  );
}

function RuntimeChip({
  role,
  models,
  runtime,
  lockedFamily,
  disabled,
  size,
  onChange,
}: {
  role: CodexRole;
  models: readonly CodexModelOption[];
  runtime: CodexRoleRuntime;
  lockedFamily: string | null;
  disabled: boolean;
  size: PickerSize;
  onChange: (runtime: CodexRoleRuntime) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const style = sizeStyles[size];
  const selectedModel = models.find((model) => model.id === runtime.model);
  // The chip sits on a centred row, so a label-width change would shift both
  // chips on every pick. Each half reserves the widest value the catalog can put
  // in it and centres inside that; the chip is monospaced, so `ch` is exact.
  const columns = useMemo(() => {
    let model = 0;
    let effort = 0;
    for (const option of models) {
      model = Math.max(model, shortModelLabel(option, option.id).length);
      for (const level of option.efforts) effort = Math.max(effort, level.length);
    }
    return { model, effort };
  }, [models]);
  return (
    <Stack direction="row" alignItems="center" sx={{ gap: style.gap }}>
      {/* The role label outranks its value: ink body type against a muted chip. */}
      <Typography
        component="span"
        sx={{
          color: tokens.ink,
          fontSize: style.labelSize,
          fontWeight: 680,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {roleLabels[role]}
      </Typography>
      <ButtonBase
        type="button"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-label={`${roleLabels[role]} Codex runtime`}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          height: style.height,
          px: 0.9,
          gap: 0.5,
          border: `1px solid ${tokens.hair}`,
          borderRadius: 999,
          background: tokens.leafbg,
          color: tokens.sub,
          fontFamily: tokens.mono,
          fontSize: style.fontSize,
          whiteSpace: 'nowrap',
          transition: `border-color 160ms ${tokens.ease}, background 160ms ${tokens.ease}`,
          '&:hover': { borderColor: 'rgba(31,111,107,.4)', background: tokens.tile2 },
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
        }}
      >
        <Box
          component="span"
          sx={{
            minWidth: `${columns.model}ch`,
            color: tokens.ink,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          {shortModelLabel(selectedModel, runtime.model)}
        </Box>
        <Box
          aria-hidden
          component="span"
          sx={{ alignSelf: 'stretch', my: 0.45, borderLeft: `1px solid ${tokens.hair}` }}
        />
        <Box
          component="span"
          sx={{
            minWidth: `${columns.effort}ch`,
            color: tokens.teal,
            letterSpacing: '.06em',
            textAlign: 'center',
          }}
        >
          {runtime.effort}
        </Box>
        {/* This slot always occupies the same width. Normal/Fast switches must
            never recenter the pair of role selectors around the composer. */}
        <Box
          component="span"
          data-testid={`${role}-fast-indicator`}
          sx={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 12,
            height: 12,
            borderRadius: 999,
            background:
              runtime.serviceTier === 'fast' ? 'rgba(31,111,107,.1)' : 'rgba(104,95,84,.07)',
            color: runtime.serviceTier === 'fast' ? tokens.teal : tokens.sub2,
            fontSize: 7,
            fontWeight: 780,
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          {runtime.serviceTier === 'fast' ? 'F' : 'N'}
        </Box>
        <ExpandMoreRounded aria-hidden sx={{ fontSize: 13, color: tokens.sub2 }} />
      </ButtonBase>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        // Both chip rows sit low on the page — above the trigger keeps the grid
        // clear of the composer instead of pushing it off-screen.
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: '-6px',
              border: `1px solid ${tokens.hair}`,
              borderRadius: 1.2,
              background: tokens.tile,
              boxShadow: tokens.shadowLift,
            },
          },
        }}
      >
        <RuntimePanel
          role={role}
          models={models}
          runtime={runtime}
          lockedFamily={lockedFamily}
          disabled={disabled}
          onChange={onChange}
        />
      </Popover>
    </Stack>
  );
}

/**
 * Both role chips. `lockedFamilies` marks conversations that already have turns:
 * the model may still move within its family and the effort is always free, but
 * crossing families would orphan the Codex session that carries the history.
 */
export default function CodexRuntimePicker({
  models,
  selection,
  lockedFamilies = null,
  size = 'sm',
  compact = false,
  unavailable = false,
  disabled = false,
  onChange,
}: {
  models: readonly CodexModelOption[];
  selection: CodexRuntimeSelection;
  lockedFamilies?: Record<CodexRole, string> | null;
  size?: PickerSize;
  /** Keep the role pair visually grouped inside the narrow docked Agent pane. */
  compact?: boolean;
  /** The catalog answered with nothing, or not at all. */
  unavailable?: boolean;
  /** Active turns snapshot their runtime, so edits resume after the turn. */
  disabled?: boolean;
  onChange: (role: CodexRole, runtime: CodexRoleRuntime) => void;
}) {
  // An empty catalog must say so rather than silently removing the control —
  // most often it means the conversation backend predates the model registry.
  if (models.length === 0)
    return unavailable ? <UnavailableChips size={size} compact={compact} /> : null;
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="center"
      useFlexGap
      flexWrap="wrap"
      sx={{ gap: compact ? 0.9 : 2.8 }}
    >
      {ROLES.map((role) => (
        <RuntimeChip
          key={role}
          role={role}
          models={models}
          runtime={selection[role]}
          lockedFamily={lockedFamilies?.[role] ?? null}
          disabled={disabled}
          size={size}
          onChange={(runtime) => onChange(role, runtime)}
        />
      ))}
    </Stack>
  );
}

function UnavailableChips({ size, compact }: { size: PickerSize; compact: boolean }) {
  const style = sizeStyles[size];
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="center"
      useFlexGap
      flexWrap="wrap"
      sx={{ gap: compact ? 0.9 : 2.8 }}
    >
      {ROLES.map((role) => (
        <Stack key={role} direction="row" alignItems="center" sx={{ gap: style.gap }}>
          <Typography
            component="span"
            sx={{
              color: tokens.sub2,
              fontSize: style.labelSize,
              fontWeight: 680,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {roleLabels[role]}
          </Typography>
          <Tooltip
            title="The conversation backend did not return a model catalog. Restart it to pick a model and reasoning effort."
            placement="top"
          >
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                height: style.height,
                px: 0.9,
                border: `1px dashed ${tokens.hair}`,
                borderRadius: 999,
                color: tokens.sub2,
                fontFamily: tokens.mono,
                fontSize: style.fontSize,
                whiteSpace: 'nowrap',
              }}
            >
              catalog unavailable
            </Box>
          </Tooltip>
        </Stack>
      ))}
    </Stack>
  );
}

/** Backend attribution on a transcript role card — the chip, shrunk to a tag. */
export function CodexRuntimeTag({ model, effort }: { model: string; effort?: string }) {
  const deepseek = model.includes('DeepSeek');
  const color = deepseek ? tokens.violet : tokens.sub;
  const label = deepseek ? 'DeepSeek' : model.replace(/^gpt-/i, '').replace(/^5\.6-/, '');
  return (
    <Stack
      component="span"
      direction="row"
      alignItems="center"
      sx={{
        height: 14,
        px: 0.5,
        gap: 0.4,
        border: `1px solid ${deepseek ? 'rgba(101,72,220,.3)' : 'rgba(104,95,84,.25)'}`,
        borderRadius: 999,
        background: deepseek ? 'rgba(101,72,220,.06)' : 'rgba(104,95,84,.05)',
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
          letterSpacing: '.06em',
          lineHeight: 1,
          textTransform: 'uppercase',
        }}
      >
        {effort ? `${label} · ${effort}` : label}
      </Typography>
    </Stack>
  );
}
