import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

import type { ManagedJobKind, ManagedJobListItem } from '../../application/managedJobRepository';
import type { OfflineResourceCatalogItem } from '../../domain/offlineResource';
import type { SweepListItem } from '../../domain/sweep';
import { tokens } from '../../theme';
import CatalogColumnFilter from './CatalogColumnFilter';
import CatalogTag, { type CatalogTagTone } from './CatalogTag';

/** `alignment` is discovered, never launched from here, so it sits beside the
 * job kinds rather than inside them. */
type ResultKind = 'simulation' | 'alignment' | ManagedJobKind;
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
  simulation?: SweepListItem;
  job?: ManagedJobListItem;
  offlineResource?: OfflineResourceCatalogItem;
}

const EMPTY_FILTERS: SelectedFilters = {
  type: [],
  workspace: [],
  deployment: [],
  trace: [],
  axis: [],
};

const RESULT_LABELS: Record<ResultKind, string> = {
  simulation: 'Simulation',
  alignment: 'Alignment',
  timing_predict: 'Timing prediction',
  kernel_profile: 'Kernel profile',
  kernel_measure: 'Kernel measurement',
};

const RESULT_TONES: Record<ResultKind, CatalogTagTone> = {
  simulation: 'simulation',
  alignment: 'trace',
  timing_predict: 'timing',
  kernel_profile: 'profile',
  kernel_measure: 'measure',
};

function simulationTimestamp(entry: SweepListItem): number {
  const parsed = Date.parse(entry.updatedAt);
  if (Number.isFinite(parsed)) return parsed;
  const date = entry.experimentDate;
  return date ? Date.parse(`${date}T00:00:00Z`) : 0;
}

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

function jobName(job: ManagedJobListItem): string {
  return job.conversationTitle || RESULT_LABELS[job.jobKind];
}

function jobDetails(job: ManagedJobListItem): CatalogResult['detailTags'] {
  const details: { label: string; tone: CatalogTagTone }[] = [];
  if (job.status !== 'ready') details.push({ label: job.status, tone: 'measure' });
  return details;
}

function offlineResourceSubtitle(resource: OfflineResourceCatalogItem): string {
  if (resource.kind === 'timing_predict') return `${resource.caseCount ?? 0} cases`;
  if (resource.kind === 'alignment') {
    const analysed = (resource.analysisHalves ?? [])
      .filter((half) => half.status === 'complete')
      .map((half) => half.name);
    return analysed.length === 0 ? 'measured vs simulated' : `${analysed.join(' + ')} analysis`;
  }
  return resource.kernelKind || resource.table || 'kernel result';
}

function catalogResults(
  simulations: readonly SweepListItem[],
  offlineResources: readonly OfflineResourceCatalogItem[],
  jobs: readonly ManagedJobListItem[],
): readonly CatalogResult[] {
  const ownershipByResource = new Map(
    jobs.flatMap((job) => (job.analyzerResourceId ? [[job.analyzerResourceId, job] as const] : [])),
  );
  const discoveredIds = new Set(offlineResources.map((resource) => resource.resourceId));
  return [
    ...simulations.map((entry): CatalogResult => {
      const axes = entry.kind === 'singleton' ? ['single run'] : entry.axes;
      return {
        identity: `simulation:${entry.workspaceId}:${entry.sweepId}`,
        kind: 'simulation',
        workspaceId: entry.workspaceId,
        timestamp: simulationTimestamp(entry),
        name: conciseName(entry.displayName),
        subtitle: `${entry.numRuns} ${entry.numRuns === 1 ? 'run' : 'runs'}`,
        deployments: entry.deployments,
        traces: entry.traces,
        axes,
        detailTags: [
          ...entry.deployments.map((label) => ({ label, tone: 'deployment' as const })),
          ...entry.traces.map((label) => ({ label, tone: 'trace' as const })),
          ...axes.map((label) => ({
            label,
            tone: label === 'single run' ? ('singleton' as const) : ('axis' as const),
          })),
        ],
        simulation: entry,
      };
    }),
    ...offlineResources.map((resource): CatalogResult => {
      const job = ownershipByResource.get(resource.resourceId);
      return {
        identity: `offline:${resource.resourceId}`,
        kind: resource.kind,
        workspaceId: job?.workspaceId ?? resource.workspaceId,
        timestamp: Date.parse(resource.updatedAt),
        name: conciseName(resource.displayName),
        subtitle: offlineResourceSubtitle(resource),
        deployments: resource.backend ? [resource.backend] : [],
        traces: [],
        axes: resource.selector ? [resource.selector] : [],
        detailTags: [
          ...(resource.gpuName ? [{ label: resource.gpuName, tone: 'deployment' as const }] : []),
          ...(resource.backend ? [{ label: resource.backend, tone: 'deployment' as const }] : []),
          ...(resource.selector ? [{ label: resource.selector, tone: 'axis' as const }] : []),
          ...(resource.status !== 'ready'
            ? [{ label: resource.status, tone: 'measure' as const }]
            : []),
        ],
        job,
        offlineResource: resource,
      };
    }),
    ...jobs
      .filter((job) => !job.analyzerResourceId || !discoveredIds.has(job.analyzerResourceId))
      .map((job): CatalogResult => ({
        identity: `job:${job.workspaceId}:${job.resourceId}`,
        kind: job.jobKind,
        workspaceId: job.workspaceId,
        timestamp: job.updatedAt < 1_000_000_000_000 ? job.updatedAt * 1000 : job.updatedAt,
        name: jobName(job),
        subtitle: 'Awaiting Analyzer discovery',
        deployments: [],
        traces: [],
        axes: [],
        detailTags: jobDetails(job),
        job,
      })),
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

export default function ExperimentCatalog({
  entries,
  jobs,
  offlineResources,
  onActivate,
  onActivateOfflineResource,
  workspaceNames = {},
}: {
  entries: readonly SweepListItem[];
  jobs: readonly ManagedJobListItem[];
  offlineResources: readonly OfflineResourceCatalogItem[];
  onActivate: (entry: SweepListItem) => void;
  onActivateOfflineResource: (resource: OfflineResourceCatalogItem, workspaceId: string) => void;
  workspaceNames?: Readonly<Record<string, string>>;
}) {
  const [selected, setSelected] = useState<SelectedFilters>(EMPTY_FILTERS);
  const results = useMemo(
    () => catalogResults(entries, offlineResources, jobs),
    [entries, jobs, offlineResources],
  );
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
          .filter((entry) => matchesFilters(entry, selected))
          .map((entry) => entry.identity),
      ),
    [selected, sortedResults],
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
    md: '92px minmax(190px,1.35fr) 128px 148px minmax(230px,1.25fr) 30px',
  };

  return (
    <Box sx={{ borderTop: `1.5px solid ${tokens.ink}` }}>
      <Box
        aria-label="Result table columns"
        sx={{
          minHeight: 47,
          px: { xs: 1.4, md: 1.75 },
          display: 'grid',
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
            fontFamily: tokens.mono,
            fontSize: 8.5,
          }}
        >
          Run date
        </Typography>
        <Stack direction="row" alignItems="center" useFlexGap sx={{ minWidth: 0, gap: 1 }}>
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 8.5 }}>
            Result
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
            {visibleCount} matches
          </Typography>
        </Stack>
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <CatalogColumnFilter
            label="Type"
            options={options.type}
            selected={selected.type}
            onToggle={(value) => toggle('type', value)}
            onClear={() => clearKind('type')}
            optionLabel={(value) => RESULT_LABELS[value as ResultKind]}
            tone={(value) => RESULT_TONES[value as ResultKind]}
          />
        </Box>
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
        <Stack
          direction="row"
          alignItems="center"
          useFlexGap
          sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.7 }}
        >
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
          onClick={() => setSelected(EMPTY_FILTERS)}
          sx={{
            justifySelf: 'end',
            color: tokens.teal,
            fontFamily: tokens.mono,
            fontSize: 8,
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
          maxHeight: 426,
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
              aria-label={`Open ${RESULT_LABELS[entry.kind]} ${entry.name}`}
              aria-selected={false}
              aria-hidden={!visible}
              disabled={!entry.offlineResource && !entry.simulation}
              tabIndex={visible ? 0 : -1}
              onClick={() =>
                entry.offlineResource
                  ? onActivateOfflineResource(entry.offlineResource, entry.workspaceId)
                  : onActivate(entry.simulation!)
              }
              sx={{
                width: '100%',
                minHeight: visible ? 71 : 0,
                maxHeight: visible ? 90 : 0,
                px: { xs: 1.4, md: 1.75 },
                py: visible ? 1.25 : 0,
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
                  background: 'rgba(31,111,107,.045)',
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
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
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
                    fontFamily: tokens.mono,
                    fontSize: 13.5,
                    fontWeight: 500,
                    letterSpacing: '-.015em',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.name}
                </Typography>
                <Typography
                  sx={{ mt: 0.35, color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 }}
                >
                  {entry.subtitle}
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
