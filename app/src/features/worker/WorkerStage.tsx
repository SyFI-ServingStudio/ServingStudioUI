import { Button, Paper, Stack, Typography } from '@mui/material';

import { useActiveRunState, useActiveRunSubject } from '../../application/ActiveRunProvider';
import {
  useActiveWorkerTreeState,
  type ActiveWorkerTreeState,
  type WorkerTreeNonReadyStatus,
} from '../../application/WorkerTreeProvider';
import type { DetailArtifact } from '../../domain/artifacts';
import type { SubjectName, SubjectResult } from '../../domain/subject';
import { KernelDetail, ParallelDetail } from '../kernel';
import { tokens } from '../../theme';
import CostTreeFlow from './CostTreeFlow';
import TimeShareBlocks from './TimeShareBlocks';

interface EvidenceRow {
  readonly label: string;
  readonly status: string;
  readonly reason: string;
}

function detailEvidence(label: string, detail: DetailArtifact | undefined): EvidenceRow {
  const status = detail?.status ?? 'not_generated';
  const reason =
    detail && 'reason' in detail && detail.reason
      ? detail.reason
      : detail === undefined
        ? 'Run descriptor does not declare this detail resource.'
        : status === 'ready'
          ? 'Versioned Analyzer detail is ready.'
          : `Analyzer detail is ${status}.`;
  return { label, status, reason };
}

function subjectEvidence<Name extends SubjectName>(
  label: string,
  subject: SubjectResult<Name>,
): EvidenceRow {
  const reason =
    'reason' in subject && subject.reason
      ? subject.reason
      : subject.status === 'ready'
        ? 'Typed Analyzer subject is ready.'
        : `Analyzer subject is ${subject.status}.`;
  return { label, status: subject.status, reason };
}

/** Explicit availability matrix for optional worker facts. It never turns a
 * missing detail into zero records or a generated curve. */
function WorkerEvidenceMatrix() {
  const activeRun = useActiveRunState();
  const backpressure = useActiveRunSubject('backpressure');
  const kernelInputDistribution = useActiveRunSubject('kernelInputDistribution');
  if (activeRun.status !== 'ready') return null;
  const rows = [
    detailEvidence(
      'Iteration index / batch composition',
      activeRun.descriptor.details['worker-iteration-index'],
    ),
    detailEvidence('Iteration detail', activeRun.descriptor.details['iteration-detail']),
    subjectEvidence('Pending queue / backpressure', backpressure),
    subjectEvidence('Kernel input distribution', kernelInputDistribution),
  ];

  return (
    <Paper sx={{ borderRadius: 2, p: '15px 18px 18px' }}>
      <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
        Optional worker evidence
      </Typography>
      <Typography sx={{ mt: 0.35, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
        Missing resources stay explicit until Analyzer publishes a versioned worker endpoint.
      </Typography>
      <Stack spacing={0} sx={{ mt: 1.25, border: `1px solid ${tokens.hair}`, borderRadius: 1.25 }}>
        {rows.map((row, index) => (
          <Stack
            key={row.label}
            direction={{ xs: 'column', md: 'row' }}
            useFlexGap
            sx={{
              gap: { xs: 0.4, md: 1.5 },
              p: '10px 12px',
              borderTop: index === 0 ? 0 : `1px solid ${tokens.hair}`,
              background: tokens.tile2,
            }}
          >
            <Typography sx={{ minWidth: 230, fontFamily: tokens.mono, fontSize: 10.5 }}>
              {row.label}
            </Typography>
            <Typography
              sx={{
                minWidth: 110,
                fontFamily: tokens.mono,
                fontSize: 9.5,
                color: row.status === 'failed' ? tokens.terra : tokens.gold,
              }}
            >
              {row.status}
            </Typography>
            <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}>
              {row.reason}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function ReadyWorkerStage() {
  const treeState = useActiveWorkerTreeState();
  if (treeState.status !== 'ready') return null;
  return (
    <Stack spacing={2}>
      {treeState.evidence === 'aggregate-projection' && (
        <Paper sx={{ borderRadius: 2, p: 2, borderLeft: `3px solid ${tokens.gold}` }}>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
            Aggregate worker evidence only
          </Typography>
          <Typography
            sx={{
              mt: 0.5,
              fontFamily: tokens.mono,
              fontSize: 10.5,
              lineHeight: 1.6,
              color: tokens.sub,
            }}
          >
            This visual CostTree is projected from the real kernel-time-share worker composition. It
            is not hierarchical iteration detail, and its total is full-run aggregate kernel time.
          </Typography>
        </Paper>
      )}
      <CostTreeFlow />
      <KernelDetail />
      <ParallelDetail />
      <TimeShareBlocks />
      <WorkerEvidenceMatrix />
    </Stack>
  );
}

type NonReadyWorkerTreeState = Extract<ActiveWorkerTreeState, { status: WorkerTreeNonReadyStatus }>;

function nonReadyTitle(state: NonReadyWorkerTreeState): string {
  if (state.status === 'failed') {
    return state.evidence === 'hierarchical-detail'
      ? 'Could not load worker CostTree detail'
      : 'Could not load aggregate worker evidence';
  }
  const titles: Record<Exclude<WorkerTreeNonReadyStatus, 'failed'>, string> = {
    empty: 'No reportable worker kernel time',
    unavailable: 'Worker evidence unavailable',
    not_generated: 'Worker evidence not generated',
    incompatible: 'Worker evidence is incompatible',
  };
  return titles[state.status];
}

function NonReadyWorkerStage({ state }: { state: NonReadyWorkerTreeState }) {
  const failed = state.status === 'failed';
  return (
    <Paper
      role={failed ? 'alert' : 'status'}
      sx={{ borderRadius: 2, p: 3, borderLeft: `3px solid ${failed ? tokens.terra : tokens.gold}` }}
    >
      <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
        {nonReadyTitle(state)}
      </Typography>
      <Typography
        sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub, lineHeight: 1.6 }}
      >
        {state.reason}
      </Typography>
      <Typography sx={{ mt: 1, fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2 }}>
        evidence status · {state.status}
        {state.code ? ` · ${state.code}` : ''}
      </Typography>
      {state.retry && (
        <Button size="small" onClick={state.retry} sx={{ mt: 1.5 }}>
          Retry worker detail
        </Button>
      )}
    </Paper>
  );
}

export default function WorkerStage() {
  const state = useActiveWorkerTreeState();
  if (state.status === 'loading' || state.status === 'idle') {
    const worker = state.status === 'loading' ? state.worker.key : 'selected worker';
    const hierarchicalDetail =
      state.status === 'loading' && state.evidence === 'hierarchical-detail';
    return (
      <Paper role="status" aria-busy="true" sx={{ borderRadius: 2, p: 3 }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          {hierarchicalDetail
            ? 'Loading worker CostTree detail'
            : 'Preparing aggregate worker evidence'}
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
          Loading evidence for {worker}…
        </Typography>
      </Paper>
    );
  }
  if (state.status === 'error') {
    return (
      <Paper role="alert" sx={{ borderRadius: 2, p: 3, borderLeft: `3px solid ${tokens.terra}` }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          Invalid worker selection
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
          {state.error.message}
        </Typography>
      </Paper>
    );
  }
  if (state.status !== 'ready') return <NonReadyWorkerStage state={state} />;
  return <ReadyWorkerStage />;
}
