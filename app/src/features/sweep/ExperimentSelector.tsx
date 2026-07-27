import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { SweepListItem } from '../../domain/sweep';
import { tokens } from '../../theme';

interface DateGroup {
  date: string;
  entries: readonly SweepListItem[];
}

function dateKey(entry: SweepListItem): string {
  return entry.experimentDate ?? entry.updatedAt.slice(0, 10);
}

function dateParts(date: string): { weekday: string; monthDay: string; year: string } {
  const instant = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(instant.getTime())) {
    return { weekday: 'Undated', monthDay: date, year: '' };
  }
  return {
    weekday: instant.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    monthDay: instant.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    year: instant.getUTCFullYear().toString(),
  };
}

function uniqueValues(
  entries: readonly SweepListItem[],
  select: (entry: SweepListItem) => readonly string[],
): readonly string[] {
  return Array.from(new Set(entries.flatMap(select))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function entryMatches(
  entry: SweepListItem,
  search: string,
  deployments: readonly string[],
  traces: readonly string[],
): boolean {
  if (
    deployments.length > 0 &&
    !deployments.some((deployment) => entry.deployments.includes(deployment))
  ) {
    return false;
  }
  if (traces.length > 0 && !traces.some((trace) => entry.traces.includes(trace))) return false;
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [entry.displayName, ...entry.axes, ...entry.deployments, ...entry.traces].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function shortExperimentName(displayName: string): string {
  return displayName.replace(/^\d{8}_/, '');
}

function groupEntries(entries: readonly SweepListItem[]): readonly DateGroup[] {
  const grouped = new Map<string, SweepListItem[]>();
  entries.forEach((entry) => {
    const date = dateKey(entry);
    const group = grouped.get(date);
    if (group) group.push(entry);
    else grouped.set(date, [entry]);
  });
  return Array.from(grouped, ([date, dateEntries]) => ({
    date,
    entries: dateEntries.sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.displayName.localeCompare(right.displayName),
    ),
  })).sort((left, right) => right.date.localeCompare(left.date));
}

function LabelFilter({
  label,
  selectedValues,
  options,
  onToggle,
}: {
  label: string;
  selectedValues: readonly string[];
  options: readonly string[];
  onToggle: (value: string) => void;
}) {
  const labelId = `${label.toLowerCase()}-filter-label`;
  return (
    <Box role="group" aria-labelledby={labelId}>
      <Typography
        id={labelId}
        sx={{ display: 'block', mb: 0.45, color: tokens.sub, fontSize: 9.5, fontWeight: 600 }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.55,
        }}
      >
        {options.map((option) => (
          <ButtonBase
            key={option}
            aria-pressed={selectedValues.includes(option)}
            onClick={() => onToggle(option)}
            sx={{
              minHeight: 25,
              px: 0.9,
              border: `1px solid ${selectedValues.includes(option) ? tokens.teal : tokens.hair}`,
              borderRadius: 1.25,
              background: selectedValues.includes(option) ? 'rgba(31,111,107,.1)' : tokens.tile,
              color: selectedValues.includes(option) ? tokens.teal : tokens.sub,
              fontFamily: tokens.mono,
              fontSize: 9,
              fontWeight: 600,
              lineHeight: 1,
              transition: `background 140ms ${tokens.ease}, border-color 140ms ${tokens.ease}`,
              '&:hover': { borderColor: tokens.teal, color: tokens.teal },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              '&:active': { transform: 'translateY(1px)' },
            }}
          >
            {option}
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}

export default function ExperimentSelector({
  entries,
  selectedId,
  onSelect,
  onActivate,
}: {
  entries: readonly SweepListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedDeployments, setSelectedDeployments] = useState<readonly string[]>([]);
  const [selectedTraces, setSelectedTraces] = useState<readonly string[]>([]);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const deployments = useMemo(() => uniqueValues(entries, (entry) => entry.deployments), [entries]);
  const traces = useMemo(() => uniqueValues(entries, (entry) => entry.traces), [entries]);
  const visibleEntries = useMemo(
    () =>
      entries.filter((entry) => entryMatches(entry, search, selectedDeployments, selectedTraces)),
    [entries, search, selectedDeployments, selectedTraces],
  );
  const groups = useMemo(() => groupEntries(visibleEntries), [visibleEntries]);
  const visibleIds = useMemo(() => visibleEntries.map((entry) => entry.sweepId), [visibleEntries]);
  const hasFilters = Boolean(search || selectedDeployments.length || selectedTraces.length);

  const toggleFilter = (
    value: string,
    selectedValues: readonly string[],
    setSelectedValues: (values: readonly string[]) => void,
  ) => {
    setSelectedValues(
      selectedValues.includes(value)
        ? selectedValues.filter((selectedValue) => selectedValue !== value)
        : [...selectedValues, value],
    );
  };

  useEffect(() => {
    if (visibleIds.length > 0 && (selectedId === null || !visibleIds.includes(selectedId))) {
      onSelect(visibleIds[0]);
    }
  }, [onSelect, selectedId, visibleIds]);

  const moveSelection = (event: React.KeyboardEvent, destination: number) => {
    if (visibleIds.length === 0) return;
    event.preventDefault();
    const nextId = visibleIds[Math.max(0, Math.min(destination, visibleIds.length - 1))];
    onSelect(nextId);
    optionRefs.current.get(nextId)?.focus();
  };

  const handleListKeyDown = (event: React.KeyboardEvent) => {
    const currentIndex = Math.max(0, visibleIds.indexOf(selectedId ?? ''));
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      moveSelection(event, (currentIndex + 1) % visibleIds.length);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      moveSelection(event, (currentIndex - 1 + visibleIds.length) % visibleIds.length);
    } else if (event.key === 'Home') {
      moveSelection(event, 0);
    } else if (event.key === 'End') {
      moveSelection(event, visibleIds.length - 1);
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ md: 'flex-end' }}
        useFlexGap
        sx={{ gap: 1.2 }}
      >
        <Box sx={{ flex: 1, minWidth: { md: 240 } }}>
          <Typography
            component="label"
            htmlFor="experiment-search"
            sx={{ display: 'block', mb: 0.45, color: tokens.sub, fontSize: 9.5, fontWeight: 600 }}
          >
            Find experiment
          </Typography>
          <Box
            component="input"
            id="experiment-search"
            type="search"
            value={search}
            placeholder="Name, axis, trace, or deployment"
            onChange={(event) => setSearch(event.target.value)}
            sx={{
              width: '100%',
              height: 36,
              boxSizing: 'border-box',
              px: 1.2,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 1.25,
              background: tokens.tile,
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 12,
              '&::placeholder': { color: tokens.sub2, opacity: 1 },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          />
        </Box>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ minWidth: 132, height: 36 }}
        >
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 9.5 }}>
            {visibleEntries.length}/{entries.length} shown
          </Typography>
          {hasFilters && (
            <ButtonBase
              onClick={() => {
                setSearch('');
                setSelectedDeployments([]);
                setSelectedTraces([]);
              }}
              sx={{
                px: 0.8,
                py: 0.5,
                color: tokens.teal,
                fontFamily: tokens.mono,
                fontSize: 9,
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              Clear
            </ButtonBase>
          )}
        </Stack>
      </Stack>
      <Box
        sx={{
          mt: 1,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.35fr)' },
          gap: { xs: 1, md: 2 },
        }}
      >
        <LabelFilter
          label="Deployment"
          selectedValues={selectedDeployments}
          options={deployments}
          onToggle={(value) => toggleFilter(value, selectedDeployments, setSelectedDeployments)}
        />
        <LabelFilter
          label="Trace"
          selectedValues={selectedTraces}
          options={traces}
          onToggle={(value) => toggleFilter(value, selectedTraces, setSelectedTraces)}
        />
      </Box>

      <Box
        role="listbox"
        aria-label="Experiments by date"
        onKeyDown={handleListKeyDown}
        sx={{
          mt: 1.25,
          maxHeight: 390,
          overflowY: 'auto',
          border: `1px solid ${tokens.hair}`,
          borderRadius: 1.5,
          background: 'rgba(250,247,240,.58)',
          p: { xs: 1.1, md: 1.5 },
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.hair} transparent`,
        }}
      >
        {groups.length === 0 ? (
          <Typography role="status" sx={{ p: 2, color: tokens.sub, fontSize: 12 }}>
            No experiments match these filters.
          </Typography>
        ) : (
          <Stack spacing={1.6}>
            {groups.map((group) => {
              const parts = dateParts(group.date);
              return (
                <Box
                  key={group.date}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '96px minmax(0, 1fr)' },
                    gap: { xs: 0.8, sm: 1.5 },
                  }}
                >
                  <Box
                    sx={{
                      borderRight: { sm: `1px solid ${tokens.hair}` },
                      pr: { sm: 1.5 },
                      pt: 0.35,
                    }}
                  >
                    <Typography
                      sx={{
                        color: tokens.sub,
                        fontFamily: tokens.mono,
                        fontSize: 8.5,
                        fontWeight: 600,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {parts.weekday}
                    </Typography>
                    <Typography
                      sx={{ mt: 0.1, color: tokens.ink, fontFamily: tokens.serif, fontSize: 15 }}
                    >
                      {parts.monthDay}
                    </Typography>
                    <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
                      {parts.year} · {group.entries.length}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
                      gap: 0.8,
                    }}
                  >
                    {group.entries.map((entry) => {
                      const selected = entry.sweepId === selectedId;
                      const primaryMetadata = [...entry.deployments, ...entry.traces].join(' · ');
                      const geometry =
                        entry.kind === 'singleton'
                          ? 'single run'
                          : `${entry.axes.join(' × ')} · ${entry.numRuns} runs`;
                      return (
                        <ButtonBase
                          key={entry.sweepId}
                          ref={(node: HTMLButtonElement | null) => {
                            if (node) optionRefs.current.set(entry.sweepId, node);
                            else optionRefs.current.delete(entry.sweepId);
                          }}
                          role="option"
                          aria-label={entry.displayName}
                          aria-selected={selected}
                          onClick={() => (onActivate ?? onSelect)(entry.sweepId)}
                          sx={{
                            minWidth: 0,
                            minHeight: 76,
                            display: 'block',
                            p: 1.05,
                            overflow: 'hidden',
                            border: `1px solid ${selected ? tokens.teal : tokens.hair}`,
                            borderRadius: 1.25,
                            background: selected ? 'rgba(31,111,107,.07)' : tokens.tile,
                            boxShadow: selected ? `inset 0 0 0 1px ${tokens.teal}` : 'none',
                            textAlign: 'left',
                            transition: `background 140ms ${tokens.ease}, border-color 140ms ${tokens.ease}`,
                            '&:hover': { borderColor: tokens.teal },
                            '&:focus-visible': {
                              outline: `2px solid ${tokens.teal}`,
                              outlineOffset: 1,
                            },
                            '&:active': { transform: 'translateY(1px)' },
                          }}
                        >
                          <Stack direction="row" justifyContent="space-between" sx={{ gap: 1 }}>
                            <Typography
                              sx={{
                                color: selected ? tokens.teal : tokens.sub,
                                fontFamily: tokens.mono,
                                fontSize: 8,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                              }}
                            >
                              {entry.kind}
                            </Typography>
                            <Typography
                              sx={{
                                color: entry.status === 'ready' ? tokens.teal : tokens.terra,
                                fontFamily: tokens.mono,
                                fontSize: 8,
                                textTransform: 'uppercase',
                              }}
                            >
                              {entry.status}
                            </Typography>
                          </Stack>
                          <Typography
                            title={entry.displayName}
                            sx={{
                              mt: 0.45,
                              overflow: 'hidden',
                              color: tokens.ink,
                              fontSize: 12.5,
                              fontWeight: 650,
                              lineHeight: 1.25,
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {shortExperimentName(entry.displayName)}
                          </Typography>
                          <Typography
                            title={primaryMetadata}
                            sx={{
                              mt: 0.45,
                              overflow: 'hidden',
                              color: tokens.sub,
                              fontFamily: tokens.mono,
                              fontSize: 8.5,
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {primaryMetadata || 'metadata unavailable'}
                          </Typography>
                          <Typography
                            sx={{
                              mt: 0.15,
                              color: tokens.sub2,
                              fontFamily: tokens.mono,
                              fontSize: 8,
                            }}
                          >
                            {geometry}
                          </Typography>
                        </ButtonBase>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
