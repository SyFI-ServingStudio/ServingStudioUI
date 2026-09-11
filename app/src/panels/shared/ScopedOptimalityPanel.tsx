import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import {
  readArtifact,
  type ScopedOptimalityRef,
  type ScopedOptimalityReport,
} from '../../artifacts';
import { EvidenceSurfaceCard } from '../../ui/controls/EvidenceSurfaceCard';
import { tokens } from '../../ui/theme';

const RUNG_LABELS: Readonly<Record<string, string>> = {
  r0_measured: 'R0 Measured',
  r5_hardware_limit: 'R5 Hardware limit',
  r6_segmented_necessary: 'R6 Segmented necessary',
  r7_scope_fused_necessary: 'R7 Scope-fused necessary',
};

/** GPU-seconds span engineering units: scoped floors of a single operator run
 * from nanoseconds to whole seconds within one run. */
function fmtGpuSeconds(value: number): string {
  if (value >= 1) return `${value.toFixed(4)} GPU·s`;
  if (value >= 1e-3) return `${(value * 1e3).toFixed(4)} GPU·ms`;
  if (value >= 1e-6) return `${(value * 1e6).toFixed(4)} GPU·µs`;
  return `${(value * 1e9).toFixed(4)} GPU·ns`;
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; report: ScopedOptimalityReport }
  | { status: 'error'; message: string };

/** On-demand scoped optimality (R0/R5/R6/R7) for one CostTree node. Compute is
 * explicit: the analyzer folds the whole artifact's cost log for the scope,
 * which is too heavy to fire on every node click. The `resetKey` names the
 * current selection; a different node must never leave stale numbers up. */
export default function ScopedOptimalityPanel({
  caption,
  hint,
  resetKey,
  artifact,
  evidence,
}: {
  /** Selected node caption, or null when nothing scopeable is selected. */
  caption: string | null;
  hint: string;
  resetKey: string | null;
  artifact: ScopedOptimalityRef | null;
  evidence: {
    readonly evidenceId: string;
    readonly selectedForAgent: boolean;
    readonly onEvidenceSelect: () => void;
  };
}) {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });

  useEffect(() => {
    setFetchState({ status: 'idle' });
  }, [resetKey]);

  const run = () => {
    if (artifact === null) return;
    setFetchState({ status: 'loading' });
    readArtifact(artifact)
      .then((result) => {
        if (result.status === 'ready') {
          setFetchState({ status: 'ready', report: result.value });
          return;
        }
        setFetchState({
          status: 'error',
          message: ('reason' in result ? result.reason : undefined) ?? 'Scoped optimality failed.',
        });
      })
      .catch((error: unknown) =>
        setFetchState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Scoped optimality failed.',
        }),
      );
  };

  const report = fetchState.status === 'ready' ? fetchState.report : null;
  const r0 = report?.rungs.find((rung) => rung.key === 'r0_measured') ?? null;

  return (
    <EvidenceSurfaceCard {...evidence} data-testid="scoped-optimality-card" sx={{ p: '14px 15px' }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" useFlexGap>
        <Box>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
            Scoped optimality
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
            {caption ?? hint}
          </Typography>
        </Box>
        <Button
          size="small"
          disabled={artifact === null || fetchState.status === 'loading'}
          onClick={run}
        >
          {fetchState.status === 'loading' ? 'Computing…' : 'Compute'}
        </Button>
      </Stack>

      {fetchState.status === 'loading' && (
        <Stack direction="row" alignItems="center" useFlexGap sx={{ mt: 1.5, gap: 1 }}>
          <CircularProgress size={14} />
          <Typography sx={{ fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
            Folding this scope over the cost log…
          </Typography>
        </Stack>
      )}

      {fetchState.status === 'error' && (
        <Typography
          role="alert"
          sx={{ mt: 1.5, fontFamily: tokens.mono, fontSize: 10.5, color: tokens.terra }}
        >
          {fetchState.message}
        </Typography>
      )}

      {report !== null && (
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2 }}>
            resolved {report.nodeLabel ?? report.canonicalPath} · {report.matchedWorkers}{' '}
            {report.matchedWorkers === 1 ? 'worker' : 'workers'} ·{' '}
            {report.matchedRows.toLocaleString()} cost rows · {report.descendantLeaves.length}{' '}
            {report.descendantLeaves.length === 1 ? 'leaf' : 'leaves'}
          </Typography>
          <Box
            component="table"
            sx={{
              mt: 1,
              width: '100%',
              borderCollapse: 'collapse',
              '& td, & th': {
                py: 0.5,
                borderBottom: `1px solid ${tokens.hair}`,
                fontFamily: tokens.mono,
                fontSize: 10.5,
                textAlign: 'left',
              },
              '& td:last-of-type, & th:last-of-type': { textAlign: 'right' },
            }}
          >
            <thead>
              <tr>
                <Box component="th" sx={{ color: tokens.sub }}>
                  Rung
                </Box>
                <Box component="th" sx={{ color: tokens.sub }}>
                  GPU time
                </Box>
                <Box component="th" sx={{ color: tokens.sub }}>
                  of R0
                </Box>
              </tr>
            </thead>
            <tbody>
              {report.rungs.map((rung) => (
                <tr key={rung.key}>
                  <Box component="td" title={rung.definition}>
                    {RUNG_LABELS[rung.key] ?? rung.key}
                  </Box>
                  <td>{fmtGpuSeconds(rung.gpuSeconds)}</td>
                  <td>
                    {r0 !== null && r0.gpuSeconds > 0
                      ? `${((rung.gpuSeconds / r0.gpuSeconds) * 100).toFixed(2)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
          {report.omittedRungs.length > 0 && (
            <Typography sx={{ mt: 1, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
              omitted at subtree scope:{' '}
              {report.omittedRungs.map((omission) => omission.rung).join(', ')}
            </Typography>
          )}
        </Box>
      )}
    </EvidenceSurfaceCard>
  );
}
