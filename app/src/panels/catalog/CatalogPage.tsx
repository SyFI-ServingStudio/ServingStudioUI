/** The six Analyzer catalogs projected into the original Page 0 result surface. */
import { Alert, Box, Skeleton, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';

import { catalogRef, useArtifacts, type ArtifactResult } from '../../artifacts';
import { type CatalogFilter, type Navigate, type ResultKind } from '../../location';
import { tokens, withAlpha } from '../../ui/theme';
import { visibleEntries } from './entries';
import ResultCatalog from './ResultCatalog';
import type { Workspace } from '../../session/types';
import type { ManagedJob } from '../../session/types';
import { listManagedJobs } from '../../session/api';

const PAGE_ZERO_KINDS: readonly ResultKind[] = [
  'sweep',
  'prediction',
  'alignment',
  'kernelProfile',
  'kernelMeasurement',
];

const KIND_LABEL: Record<ResultKind, string> = {
  run: 'Run',
  sweep: 'Sweep',
  prediction: 'Prediction',
  alignment: 'Alignment',
  kernelProfile: 'Kernel profile',
  kernelMeasurement: 'Kernel measurement',
};

interface ReadProblem {
  kind: ResultKind;
  severity: 'error' | 'warning' | 'info';
  reason: string;
}

function readProblems(
  results: readonly ArtifactResult<unknown>[],
  kinds: readonly ResultKind[],
): readonly ReadProblem[] {
  return kinds.flatMap<ReadProblem>((kind, index) => {
    const result = results[index];
    if (result === undefined) return [];
    switch (result.status) {
      case 'failed':
        return [{ kind, severity: 'error', reason: result.reason }];
      case 'incompatible':
        return [{ kind, severity: 'warning', reason: result.reason }];
      case 'unavailable':
        return [{ kind, severity: 'info', reason: `not served by this Analyzer (${result.code})` }];
      case 'pending':
      case 'ready':
      case 'not_generated':
        return [];
    }
  });
}

export function CatalogPage({
  filter,
  navigate,
  workspaces,
}: {
  filter: CatalogFilter;
  navigate: Navigate;
  workspaces: readonly Workspace[];
}) {
  const [jobs, setJobs] = useState<readonly ManagedJob[]>([]);
  const [jobsPending, setJobsPending] = useState(true);
  const refs = useMemo(
    () => PAGE_ZERO_KINDS.map((kind) => catalogRef(filter.workspace, kind)),
    [filter.workspace],
  );
  const results = useArtifacts(refs);
  const entries = useMemo(
    () => visibleEntries(results, { ...filter, kinds: [], query: null }),
    [results, filter],
  );
  const problems = readProblems(results, PAGE_ZERO_KINDS);
  const pending = results.every((result) => result.status === 'pending');
  const workspaceNames = useMemo(
    () => Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.label])),
    [workspaces],
  );
  useEffect(() => {
    const abort = new AbortController();
    setJobsPending(true);
    void listManagedJobs(abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) setJobs(items);
      })
      .catch(() => {
        if (!abort.signal.aborted) setJobs([]);
      })
      .finally(() => {
        if (!abort.signal.aborted) setJobsPending(false);
      });
    return () => abort.abort();
  }, []);

  return (
    <Box>
      <Box sx={{ maxWidth: 760, mb: 3, textAlign: 'left' }}>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontSize: 'clamp(30px,3vw,42px)',
            fontWeight: 600,
            letterSpacing: '-.035em',
            lineHeight: 1,
          }}
        >
          Results
        </Typography>
        <Typography sx={{ maxWidth: 640, mt: 1.5, color: tokens.sub, fontSize: 16 }}>
          Explore simulations, timing predictions, and kernel measurements across your workspaces.
        </Typography>
      </Box>
      {problems.length > 0 && (
        <Stack spacing={1} sx={{ mb: 2 }}>
          {problems.map((problem) => (
            <Alert key={problem.kind} severity={problem.severity}>
              <strong>{KIND_LABEL[problem.kind]}</strong>: {problem.reason}
            </Alert>
          ))}
        </Stack>
      )}
      {pending && jobsPending ? (
        <Skeleton
          variant="rectangular"
          height={280}
          sx={{ borderTop: `1.5px solid ${tokens.ink}`, background: withAlpha(tokens.tile, 0.35) }}
        />
      ) : entries.length === 0 && jobs.length === 0 ? (
        <Typography role="status" sx={{ py: 4, color: tokens.sub, textAlign: 'center' }}>
          {filter.kinds.length === 0 && filter.query === null
            ? 'No results are available.'
            : 'No results match this filter.'}
        </Typography>
      ) : (
        <ResultCatalog
          entries={entries}
          filter={filter}
          navigate={navigate}
          workspaceNames={workspaceNames}
          jobs={jobs}
        />
      )}
    </Box>
  );
}
