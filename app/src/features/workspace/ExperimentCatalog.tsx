import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

import type { SweepListItem } from '../../domain/sweep';
import { tokens } from '../../theme';
import CatalogColumnFilter from './CatalogColumnFilter';
import CatalogTag, { type CatalogTagTone } from './CatalogTag';

type FilterKind = 'workspace' | 'deployment' | 'trace' | 'axis';
type SelectedFilters = Record<FilterKind, readonly string[]>;

const EMPTY_FILTERS: SelectedFilters = {
  workspace: [],
  deployment: [],
  trace: [],
  axis: [],
};

function entryDate(entry: SweepListItem): string {
  return entry.experimentDate ?? entry.updatedAt.slice(0, 10);
}

function formatDate(entry: SweepListItem): string {
  const instant = new Date(`${entryDate(entry)}T00:00:00Z`);
  if (Number.isNaN(instant.getTime())) return entryDate(entry);
  return instant.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function experimentName(displayName: string): string {
  return displayName.replace(/^\d{8}_\d+_/, '');
}

function filterOptions(entries: readonly SweepListItem[], kind: FilterKind): readonly string[] {
  const values = entries.flatMap((entry) => {
    if (kind === 'workspace') return [entry.workspaceId];
    if (kind === 'deployment') return entry.deployments;
    if (kind === 'trace') return entry.traces;
    return entry.kind === 'singleton' ? ['single run'] : entry.axes;
  });
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function entryValues(entry: SweepListItem, kind: FilterKind): readonly string[] {
  if (kind === 'workspace') return [entry.workspaceId];
  if (kind === 'deployment') return entry.deployments;
  if (kind === 'trace') return entry.traces;
  return entry.kind === 'singleton' ? ['single run'] : entry.axes;
}

function matchesFilters(entry: SweepListItem, selected: SelectedFilters): boolean {
  return (Object.keys(selected) as FilterKind[]).every((kind) => {
    const values = selected[kind];
    return values.length === 0 || values.some((value) => entryValues(entry, kind).includes(value));
  });
}

function toneFor(kind: FilterKind, value: string): CatalogTagTone {
  if (kind === 'workspace') return 'workspace';
  if (kind === 'deployment') return 'deployment';
  if (kind === 'trace') return 'trace';
  return value === 'single run' ? 'singleton' : 'axis';
}

export default function ExperimentCatalog({
  entries,
  onActivate,
  workspaceNames = {},
}: {
  entries: readonly SweepListItem[];
  onActivate: (entry: SweepListItem) => void;
  workspaceNames?: Readonly<Record<string, string>>;
}) {
  const [selected, setSelected] = useState<SelectedFilters>(EMPTY_FILTERS);
  const options = useMemo(
    () => ({
      workspace: filterOptions(entries, 'workspace'),
      deployment: filterOptions(entries, 'deployment'),
      trace: filterOptions(entries, 'trace'),
      axis: filterOptions(entries, 'axis'),
    }),
    [entries],
  );
  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (left, right) =>
          entryDate(right).localeCompare(entryDate(left)) ||
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      ),
    [entries],
  );
  const visibleIds = useMemo(
    () =>
      new Set(
        sortedEntries
          .filter((entry) => matchesFilters(entry, selected))
          .map((entry) => `${entry.workspaceId}:${entry.sweepId}`),
      ),
    [selected, sortedEntries],
  );
  const visibleCount = visibleIds.size;
  const hasFilters = (Object.keys(selected) as FilterKind[]).some(
    (kind) => selected[kind].length > 0,
  );
  const toggle = (kind: FilterKind, value: string) =>
    setSelected((current) => ({
      ...current,
      [kind]: current[kind].includes(value)
        ? current[kind].filter((candidate) => candidate !== value)
        : [...current[kind], value],
    }));
  const clearKind = (kind: FilterKind) => setSelected((current) => ({ ...current, [kind]: [] }));

  const columns = {
    xs: 'minmax(0,1fr) 34px',
    md: '82px minmax(168px,1.35fr) minmax(138px,.9fr) 78px 94px minmax(128px,1fr) 28px',
    lg: '96px minmax(210px,1.35fr) minmax(176px,.82fr) 96px 128px minmax(168px,1fr) 34px',
  };
  return (
    <Box sx={{ borderTop: `1.5px solid ${tokens.ink}` }}>
      <Box
        aria-label="Experiment table columns"
        sx={{
          minHeight: 47,
          px: { xs: 1.4, md: 1.75 },
          display: 'grid',
          gridTemplateColumns: columns,
          alignItems: 'center',
          gap: { xs: 1, md: 1, lg: 1.5 },
          borderBottom: `1px solid ${tokens.hair}`,
        }}
      >
        <Typography
          sx={{
            display: { xs: 'none', md: 'block' },
            color: tokens.sub,
            fontFamily: tokens.mono,
            fontSize: 8.5,
          }}
        >
          Run date
        </Typography>
        <Stack direction="row" alignItems="center" useFlexGap sx={{ minWidth: 0, gap: 1 }}>
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 8.5 }}>
            Experiment
          </Typography>
          <Typography
            sx={{
              pl: 1,
              borderLeft: `1px solid ${tokens.hair}`,
              color: tokens.sub2,
              fontFamily: tokens.mono,
              fontSize: 8,
              whiteSpace: 'nowrap',
            }}
          >
            {visibleCount} matches, newest first
          </Typography>
        </Stack>
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <CatalogColumnFilter
            label="Workspace"
            options={options.workspace}
            selected={selected.workspace}
            onToggle={(value) => toggle('workspace', value)}
            onClear={() => clearKind('workspace')}
            optionLabel={(workspaceId) => workspaceNames[workspaceId] ?? workspaceId}
            tone="workspace"
          />
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <CatalogColumnFilter
            label="Deployment"
            options={options.deployment}
            selected={selected.deployment}
            onToggle={(value) => toggle('deployment', value)}
            onClear={() => clearKind('deployment')}
            tone="deployment"
          />
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <CatalogColumnFilter
            label="Trace"
            options={options.trace}
            selected={selected.trace}
            onToggle={(value) => toggle('trace', value)}
            onClear={() => clearKind('trace')}
            tone="trace"
          />
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <CatalogColumnFilter
            label="Sweep axes"
            options={options.axis}
            selected={selected.axis}
            onToggle={(value) => toggle('axis', value)}
            onClear={() => clearKind('axis')}
            tone={(value) => toneFor('axis', value)}
          />
        </Box>
        <ButtonBase
          disabled={!hasFilters}
          aria-label="Reset experiment filters"
          onClick={() => setSelected(EMPTY_FILTERS)}
          sx={{
            justifySelf: 'end',
            color: tokens.teal,
            fontFamily: tokens.mono,
            fontSize: 8,
            '&.Mui-disabled': { color: tokens.sub2, opacity: 0.45 },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
          }}
        >
          Reset
        </ButtonBase>
      </Box>

      <Box
        role="listbox"
        aria-label="Experiments, newest first"
        sx={{
          maxHeight: 426,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          scrollBehavior: 'smooth',
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.hair} transparent`,
        }}
      >
        <Typography
          role="status"
          aria-hidden={visibleCount !== 0}
          sx={{
            maxHeight: visibleCount === 0 ? 70 : 0,
            overflow: 'hidden',
            px: 2,
            py: visibleCount === 0 ? 2.75 : 0,
            borderBottom: `1px solid ${visibleCount === 0 ? tokens.hair : 'transparent'}`,
            opacity: visibleCount === 0 ? 1 : 0,
            visibility: visibleCount === 0 ? 'visible' : 'hidden',
            transform: visibleCount === 0 ? 'none' : 'translateY(-5px)',
            color: tokens.sub,
            fontFamily: tokens.serif,
            fontStyle: 'italic',
            textAlign: 'center',
            transition: [
              `max-height 350ms ${tokens.ease}`,
              `opacity 250ms ${tokens.ease}`,
              `transform 300ms ${tokens.ease}`,
              `padding 350ms ${tokens.ease}`,
              `border-color 200ms ${tokens.ease}`,
              `visibility 0s linear ${visibleCount === 0 ? '0ms' : '350ms'}`,
            ].join(','),
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          No experiments match this filter combination.
        </Typography>
        {sortedEntries.map((entry) => {
          const visible = visibleIds.has(`${entry.workspaceId}:${entry.sweepId}`);
          const axisValues = entry.kind === 'singleton' ? ['single run'] : entry.axes;
          return (
            <ButtonBase
              key={`${entry.workspaceId}:${entry.sweepId}`}
              role="option"
              aria-label={entry.displayName}
              aria-selected={false}
              aria-hidden={!visible}
              tabIndex={visible ? 0 : -1}
              onClick={() => onActivate(entry)}
              sx={{
                width: '100%',
                minHeight: visible ? 71 : 0,
                maxHeight: visible ? 90 : 0,
                px: { xs: 1.4, md: 1.75 },
                py: visible ? 1.25 : 0,
                display: 'grid',
                gridTemplateColumns: columns,
                alignItems: 'center',
                gap: { xs: 1, md: 1, lg: 1.5 },
                overflow: 'hidden',
                borderBottom: `1px solid ${visible ? tokens.hair : 'transparent'}`,
                opacity: visible ? 1 : 0,
                visibility: visible ? 'visible' : 'hidden',
                pointerEvents: visible ? 'auto' : 'none',
                transform: visible ? 'none' : 'translateY(-7px)',
                color: tokens.ink,
                textAlign: 'left',
                transition: [
                  `max-height 380ms ${tokens.ease}`,
                  `min-height 380ms ${tokens.ease}`,
                  `opacity 240ms ${tokens.ease}`,
                  `transform 300ms ${tokens.ease}`,
                  `padding 380ms ${tokens.ease}`,
                  `border-color 200ms ${tokens.ease}`,
                  `background 250ms ${tokens.ease}`,
                  `visibility 0s linear ${visible ? '0ms' : '380ms'}`,
                ].join(','),
                '&:hover': {
                  background: 'rgba(31,111,107,.045)',
                  '& .experiment-go': {
                    background: tokens.teal,
                    borderColor: tokens.teal,
                    color: tokens.tile,
                    transform: 'translateX(2px)',
                  },
                },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                },
              }}
            >
              <Typography
                sx={{
                  display: { xs: 'none', md: 'block' },
                  color: tokens.sub,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatDate(entry)}
              </Typography>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  title={entry.displayName}
                  sx={{
                    overflow: 'hidden',
                    color: tokens.ink,
                    fontFamily: tokens.mono,
                    fontSize: 13.5,
                    fontWeight: 500,
                    letterSpacing: '-.015em',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {experimentName(entry.displayName)}
                </Typography>
                <Typography
                  sx={{ mt: 0.35, color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 }}
                >
                  {entry.numRuns} {entry.numRuns === 1 ? 'run' : 'runs'}
                </Typography>
              </Box>
              <Stack
                direction="row"
                useFlexGap
                flexWrap="wrap"
                sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.45 }}
              >
                <CatalogTag tone="workspace">
                  {workspaceNames[entry.workspaceId] ?? entry.workspaceId}
                </CatalogTag>
              </Stack>
              <Stack
                direction="row"
                useFlexGap
                flexWrap="wrap"
                sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.45 }}
              >
                {entry.deployments.map((deployment) => (
                  <CatalogTag key={deployment} tone="deployment">
                    {deployment}
                  </CatalogTag>
                ))}
              </Stack>
              <Stack
                direction="row"
                useFlexGap
                flexWrap="wrap"
                sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.45 }}
              >
                {entry.traces.map((trace) => (
                  <CatalogTag key={trace} tone="trace">
                    {trace}
                  </CatalogTag>
                ))}
              </Stack>
              <Stack
                direction="row"
                useFlexGap
                flexWrap="wrap"
                sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.45 }}
              >
                {axisValues.map((axis) => (
                  <CatalogTag key={axis} tone={axis === 'single run' ? 'singleton' : 'axis'}>
                    {axis}
                  </CatalogTag>
                ))}
              </Stack>
              <Box
                component="span"
                className="experiment-go"
                sx={{
                  width: 30,
                  height: 30,
                  display: 'grid',
                  placeItems: 'center',
                  justifySelf: 'end',
                  border: `1px solid ${tokens.hair}`,
                  borderRadius: 999,
                  color: tokens.teal,
                  transition: [
                    `background 250ms ${tokens.ease}`,
                    `border-color 250ms ${tokens.ease}`,
                    `color 250ms ${tokens.ease}`,
                    `transform 250ms ${tokens.ease}`,
                  ].join(','),
                }}
              >
                <ArrowForwardRounded sx={{ fontSize: 16 }} />
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
