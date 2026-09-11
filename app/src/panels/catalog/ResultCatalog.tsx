import SearchRounded from '@mui/icons-material/SearchRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { Box, ButtonBase, InputBase, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';

import type { CatalogEntry } from '../../artifacts';
import type { CatalogFilter, Navigate, ResultKind } from '../../location';
import { EMPTY_FOCUS } from '../../location';
import type { ManagedJob } from '../../session/types';
import { tokens, withAlpha } from '../../ui/theme';
import CatalogColumnFilter from './CatalogColumnFilter';
import CatalogTag, { type CatalogTagTone } from '../../ui/CatalogTag';

type FilterKind = 'type' | 'workspace' | 'deployment' | 'trace' | 'axis';
type SelectedFilters = Record<FilterKind, readonly string[]>;

interface CatalogResult {
  identity: string;
  kind: ResultKind;
  workspaceId: string;
  timestamp: number;
  name: string;
  subtitle: string;
  deployments: readonly string[];
  traces: readonly string[];
  axes: readonly string[];
  detailTags: readonly { label: string; tone: CatalogTagTone }[];
  entry: CatalogEntry | null;
}

const RESULT_LABELS: Record<ResultKind, string> = {
  run: 'Run',
  sweep: 'Simulation',
  prediction: 'Timing prediction',
  alignment: 'Alignment',
  kernelProfile: 'Kernel profile',
  kernelMeasurement: 'Kernel measurement',
};

const RESULT_TONES: Record<ResultKind, CatalogTagTone> = {
  run: 'simulation',
  sweep: 'simulation',
  prediction: 'timing',
  alignment: 'alignment',
  kernelProfile: 'profile',
  kernelMeasurement: 'measure',
};

const STATUS_LABEL: Record<CatalogEntry['status'], string> = {
  ready: 'Ready',
  partial: 'Partial',
  pending: 'Running',
  not_started: 'Not started',
  failed: 'Failed',
  unknown: 'Unknown',
};

function formatDate(timestamp: number): string {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function conciseName(displayName: string): string {
  return displayName.replace(/^\d{8}_\d+_/, '');
}

function entrySubtitle(entry: CatalogEntry): string {
  if (entry.kind === 'sweep' && entry.numRuns !== undefined) {
    return `${entry.numRuns} ${entry.numRuns === 1 ? 'run' : 'runs'}`;
  }
  if (entry.kind === 'prediction') return `${entry.caseCount ?? 0} cases`;
  if (entry.kind === 'alignment') {
    const analysed = (entry.analysisHalves ?? [])
      .filter((half) => half.status === 'complete')
      .map((half) => half.name);
    return analysed.length === 0 ? 'measured vs simulated' : `${analysed.join(' + ')} analysis`;
  }
  if (entry.kind === 'kernelProfile' || entry.kind === 'kernelMeasurement') {
    return entry.kernelKind ?? entry.table ?? 'kernel result';
  }
  return entry.status === 'ready' ? RESULT_LABELS[entry.kind] : STATUS_LABEL[entry.status];
}

const JOB_KIND: Record<ManagedJob['jobKind'], ResultKind> = {
  timing_predict: 'prediction',
  kernel_profile: 'kernelProfile',
  kernel_measure: 'kernelMeasurement',
};

function catalogResults(
  entries: readonly CatalogEntry[],
  jobs: readonly ManagedJob[],
): readonly CatalogResult[] {
  const discoveredIds = new Set(entries.map((entry) => entry.id));
  return [
    ...entries.map((entry) => {
      const deployments = entry.deployments ?? [];
      const traces = entry.traces ?? [];
      const axes = entry.axes ?? [];
      return {
        identity: `${entry.kind}:${entry.workspace}:${entry.id}`,
        kind: entry.kind,
        workspaceId: entry.workspace,
        timestamp: Date.parse(entry.updatedAt),
        name: conciseName(entry.displayName),
        subtitle: entrySubtitle(entry),
        deployments,
        traces,
        axes,
        detailTags: [
          ...(entry.gpuName ? [{ label: entry.gpuName, tone: 'deployment' as const }] : []),
          ...deployments.map((label) => ({ label, tone: 'deployment' as const })),
          ...(entry.backend ? [{ label: entry.backend, tone: 'deployment' as const }] : []),
          ...traces.map((label) => ({ label, tone: 'trace' as const })),
          ...(entry.selector ? [{ label: entry.selector, tone: 'axis' as const }] : []),
          ...axes.map((label) => ({ label, tone: 'axis' as const })),
          ...(entry.status === 'ready'
            ? []
            : [{ label: entry.status.replace('_', ' '), tone: 'measure' as const }]),
        ],
        entry,
      };
    }),
    ...jobs
      .filter((job) => !job.analyzerResourceId || !discoveredIds.has(job.analyzerResourceId))
      .map((job): CatalogResult => {
        const kind = JOB_KIND[job.jobKind];
        return {
          identity: `job:${job.workspaceId}:${job.resourceId}`,
          kind,
          workspaceId: job.workspaceId,
          timestamp: job.updatedAt < 1_000_000_000_000 ? job.updatedAt * 1000 : job.updatedAt,
          name: job.conversationTitle || RESULT_LABELS[kind],
          subtitle: 'Awaiting Analyzer discovery',
          deployments: [],
          traces: [],
          axes: [],
          detailTags:
            job.status === 'ready' ? [] : [{ label: job.status, tone: 'measure' as const }],
          entry: null,
        };
      }),
  ];
}
function entryValues(entry: CatalogResult, kind: FilterKind): readonly string[] {
  if (kind === 'type') return [entry.kind];
  if (kind === 'workspace') return [entry.workspaceId];
  if (kind === 'deployment') return entry.deployments;
  if (kind === 'trace') return entry.traces;
  return entry.axes;
}

function filterOptions(entries: readonly CatalogResult[], kind: FilterKind): readonly string[] {
  return Array.from(new Set(entries.flatMap((entry) => entryValues(entry, kind)))).sort(
    (left, right) => left.localeCompare(right),
  );
}

function matchesFilters(entry: CatalogResult, selected: SelectedFilters): boolean {
  return (Object.keys(selected) as FilterKind[]).every((kind) => {
    const values = selected[kind];
    return values.length === 0 || values.some((value) => entryValues(entry, kind).includes(value));
  });
}

export default function ResultCatalog({
  entries,
  navigate,
  filter,
  jobs = [],
  workspaceNames = {},
}: {
  entries: readonly CatalogEntry[];
  navigate: Navigate;
  filter: CatalogFilter;
  jobs?: readonly ManagedJob[];
  workspaceNames?: Readonly<Record<string, string>>;
}) {
  const search = filter.query ?? '';
  const selected = useMemo<SelectedFilters>(
    () => ({
      type: filter.kinds,
      workspace: filter.workspaces ?? [],
      deployment: filter.deployments ?? [],
      trace: filter.traces ?? [],
      axis: filter.axes ?? [],
    }),
    [filter.axes, filter.deployments, filter.kinds, filter.traces, filter.workspaces],
  );
  const results = useMemo(() => catalogResults(entries, jobs), [entries, jobs]);
  const options = useMemo(
    () => ({
      type: filterOptions(results, 'type'),
      workspace: filterOptions(results, 'workspace'),
      deployment: filterOptions(results, 'deployment'),
      trace: filterOptions(results, 'trace'),
      axis: filterOptions(results, 'axis'),
    }),
    [results],
  );
  const sortedResults = useMemo(
    () => [...results].sort((left, right) => right.timestamp - left.timestamp),
    [results],
  );
  const visibleIds = useMemo(
    () =>
      new Set(
        sortedResults
          .filter(
            (entry) =>
              matchesFilters(entry, selected) &&
              [
                entry.name,
                entry.subtitle,
                RESULT_LABELS[entry.kind],
                workspaceNames[entry.workspaceId] ?? entry.workspaceId,
                ...entry.deployments,
                ...entry.traces,
                ...entry.axes,
              ]
                .join(' ')
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase()),
          )
          .map((entry) => entry.identity),
      ),
    [search, selected, sortedResults, workspaceNames],
  );
  const visibleCount = visibleIds.size;
  const hasFilters = (Object.keys(selected) as FilterKind[]).some(
    (kind) => selected[kind].length > 0,
  );
  const toggle = (kind: FilterKind, value: string) => {
    const next = selected[kind].includes(value)
      ? selected[kind].filter((candidate) => candidate !== value)
      : [...selected[kind], value];
    const field: Record<FilterKind, keyof CatalogFilter> = {
      type: 'kinds',
      workspace: 'workspaces',
      deployment: 'deployments',
      trace: 'traces',
      axis: 'axes',
    };
    navigate(
      {
        view: 'catalog',
        filter: {
          ...filter,
          [field[kind]]: kind === 'type' ? (next as ResultKind[]) : next,
        },
      },
      'replace',
    );
  };
  const clearKind = (kind: FilterKind) => {
    const field: Record<FilterKind, keyof CatalogFilter> = {
      type: 'kinds',
      workspace: 'workspaces',
      deployment: 'deployments',
      trace: 'traces',
      axis: 'axes',
    };
    navigate({ view: 'catalog', filter: { ...filter, [field[kind]]: [] } }, 'replace');
  };
  const columns = {
    xs: 'minmax(0,1fr) 34px',
    md: '100px minmax(220px,2fr) 140px 160px minmax(140px,1fr) 30px',
  };

  return (
    <Box
      sx={{
        border: `1px solid ${tokens.hair}`,
        borderRadius: '12px',
        background: tokens.tile,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        sx={{
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderBottom: `1px solid ${tokens.hair}`,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ flex: '1 1 240px', gap: 1, minWidth: 0 }}>
          <SearchRounded sx={{ color: tokens.sub2, fontSize: 20 }} />
          <InputBase
            value={search}
            onChange={(event) => {
              const query = event.target.value;
              navigate(
                {
                  view: 'catalog',
                  filter: { ...filter, query: query.trim() === '' ? null : query },
                },
                'replace',
              );
            }}
            placeholder="Search results, workspaces, or deployments"
            inputProps={{ 'aria-label': 'Search results' }}
            sx={{ width: '100%', fontSize: 14 }}
          />
        </Stack>
        <Typography sx={{ color: tokens.sub, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {visibleCount} of {results.length} results
        </Typography>
        {search && (
          <ButtonBase
            onClick={() => {
              navigate({ view: 'catalog', filter: { ...filter, query: null } }, 'replace');
            }}
            sx={{ color: tokens.teal, fontSize: 12, p: 0.5 }}
          >
            Clear search
          </ButtonBase>
        )}
      </Stack>
      <Box
        aria-label="Result table columns"
        sx={{
          minHeight: 47,
          px: { xs: 1.4, md: 1.75 },
          display: { xs: 'flex', md: 'grid' },
          flexWrap: 'wrap',
          py: 1,
          gridTemplateColumns: columns,
          alignItems: 'center',
          gap: { xs: 1, md: 1.4 },
          borderBottom: `1px solid ${tokens.hair}`,
        }}
      >
        <Typography
          sx={{
            display: { xs: 'none', md: 'block' },
            color: tokens.sub,
            fontFamily: tokens.body,
            fontSize: 12,
          }}
        >
          Run date
        </Typography>
        <Stack direction="row" alignItems="center" useFlexGap sx={{ minWidth: 0, gap: 1 }}>
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}>
            Result
          </Typography>
          <Typography
            sx={{
              pl: 1,
              borderLeft: `1px solid ${tokens.hair}`,
              color: tokens.sub2,
              fontFamily: tokens.body,
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {visibleCount} matches
          </Typography>
        </Stack>
        <CatalogColumnFilter
          label="Type"
          options={options.type}
          selected={selected.type}
          onToggle={(value) => toggle('type', value)}
          onClear={() => clearKind('type')}
          optionLabel={(value) => RESULT_LABELS[value as ResultKind]}
          tone={(value) => RESULT_TONES[value as ResultKind]}
        />
        <CatalogColumnFilter
          label="Workspace"
          options={options.workspace}
          selected={selected.workspace}
          onToggle={(value) => toggle('workspace', value)}
          onClear={() => clearKind('workspace')}
          optionLabel={(value) => workspaceNames[value] ?? value}
          tone="workspace"
        />
        <Stack direction="row" useFlexGap sx={{ gap: 0.7, flexWrap: 'wrap' }}>
          <CatalogColumnFilter
            label="Deployment"
            options={options.deployment}
            selected={selected.deployment}
            onToggle={(value) => toggle('deployment', value)}
            onClear={() => clearKind('deployment')}
            tone="deployment"
          />
          <CatalogColumnFilter
            label="Trace"
            options={options.trace}
            selected={selected.trace}
            onToggle={(value) => toggle('trace', value)}
            onClear={() => clearKind('trace')}
            tone="trace"
          />
          <CatalogColumnFilter
            label="Axes"
            options={options.axis}
            selected={selected.axis}
            onToggle={(value) => toggle('axis', value)}
            onClear={() => clearKind('axis')}
            tone={(value) => (value === 'single run' ? 'singleton' : 'axis')}
          />
        </Stack>
        <ButtonBase
          disabled={!hasFilters}
          aria-label="Reset result filters"
          onClick={() => {
            navigate(
              {
                view: 'catalog',
                filter: {
                  ...filter,
                  kinds: [],
                  workspaces: [],
                  deployments: [],
                  traces: [],
                  axes: [],
                },
              },
              'replace',
            );
          }}
          sx={{
            justifySelf: 'end',
            color: tokens.teal,
            fontFamily: tokens.body,
            fontSize: 12,
            '&.Mui-disabled': { color: tokens.sub2, opacity: 0.45 },
          }}
        >
          Reset
        </ButtonBase>
      </Box>

      <Box
        role="listbox"
        aria-label="Results, newest first"
        sx={{
          maxHeight: 'max(360px, calc(100dvh - 350px))',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
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
            transition: `max-height 350ms ${tokens.ease}, opacity 250ms ${tokens.ease}, transform 300ms ${tokens.ease}, padding 350ms ${tokens.ease}`,
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          No results match this filter combination.
        </Typography>
        {sortedResults.map((entry) => {
          const visible = visibleIds.has(entry.identity);
          return (
            <ButtonBase
              key={entry.identity}
              role="option"
              aria-label={`Open ${RESULT_LABELS[entry.kind]} ${entry.name}${entry.entry === null ? '' : ` · ${STATUS_LABEL[entry.entry.status]}`}`}
              aria-selected={false}
              aria-hidden={!visible}
              disabled={entry.entry === null}
              tabIndex={visible ? 0 : -1}
              onClick={() => {
                if (entry.entry === null) return;
                const targetKind =
                  entry.entry.kind === 'sweep' && entry.entry.runId !== undefined
                    ? 'run'
                    : entry.entry.kind;
                const targetId = entry.entry.runId ?? entry.entry.id;
                navigate(
                  {
                    view: 'result',
                    ref: {
                      kind: targetKind,
                      id: targetId,
                      workspace: entry.entry.workspace,
                    },
                    focus: EMPTY_FOCUS,
                    chat: null,
                  },
                  'push',
                );
              }}
              sx={{
                width: '100%',
                minHeight: visible ? 76 : 0,
                maxHeight: visible ? 110 : 0,
                px: { xs: 1.4, md: 1.75 },
                py: visible ? 1.75 : 0,
                display: 'grid',
                gridTemplateColumns: columns,
                alignItems: 'center',
                gap: { xs: 1, md: 1.4 },
                overflow: 'hidden',
                borderBottom: `1px solid ${visible ? tokens.hair : 'transparent'}`,
                opacity: visible ? 1 : 0,
                visibility: visible ? 'visible' : 'hidden',
                pointerEvents: visible ? 'auto' : 'none',
                transform: visible ? 'none' : 'translateY(-7px)',
                color: tokens.ink,
                textAlign: 'left',
                transition: `max-height 380ms ${tokens.ease}, min-height 380ms ${tokens.ease}, opacity 240ms ${tokens.ease}, transform 300ms ${tokens.ease}, padding 380ms ${tokens.ease}, background 250ms ${tokens.ease}`,
                '&:hover': {
                  background: withAlpha(tokens.teal, 0.045),
                  '& .result-go': {
                    background: tokens.teal,
                    borderColor: tokens.teal,
                    color: tokens.tile,
                    transform: 'translateX(2px)',
                  },
                },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            >
              <Typography
                sx={{
                  display: { xs: 'none', md: 'block' },
                  color: tokens.sub,
                  fontFamily: tokens.body,
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatDate(entry.timestamp)}
              </Typography>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  title={entry.name}
                  sx={{
                    overflow: 'hidden',
                    color: tokens.ink,
                    fontFamily: tokens.body,
                    fontSize: 15,
                    fontWeight: 500,
                    letterSpacing: '-.015em',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: 1.4,
                  }}
                >
                  {entry.name}
                </Typography>
                <Typography
                  sx={{ mt: 0.35, color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}
                >
                  {entry.subtitle}
                  <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>
                    {' '}
                    · {RESULT_LABELS[entry.kind]} · {formatDate(entry.timestamp)}
                  </Box>
                </Typography>
              </Box>
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <CatalogTag tone={RESULT_TONES[entry.kind]}>{RESULT_LABELS[entry.kind]}</CatalogTag>
              </Box>
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <CatalogTag tone="workspace">
                  {workspaceNames[entry.workspaceId] ?? entry.workspaceId}
                </CatalogTag>
              </Box>
              <Stack
                direction="row"
                useFlexGap
                flexWrap="wrap"
                sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.45 }}
              >
                {entry.detailTags.map((detail, index) => (
                  <CatalogTag key={`${detail.label}:${index}`} tone={detail.tone}>
                    {detail.label}
                  </CatalogTag>
                ))}
              </Stack>
              <Box
                component="span"
                className="result-go"
                sx={{
                  width: 30,
                  height: 30,
                  display: 'grid',
                  placeItems: 'center',
                  justifySelf: 'end',
                  border: `1px solid ${tokens.hair}`,
                  borderRadius: 999,
                  color: tokens.teal,
                  transition: `background 250ms ${tokens.ease}, border-color 250ms ${tokens.ease}, color 250ms ${tokens.ease}, transform 250ms ${tokens.ease}`,
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
