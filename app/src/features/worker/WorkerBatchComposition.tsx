import { Box } from '@mui/material';

import { useActiveRunSubject } from '../../application/ActiveRunProvider';
import { useActiveWorkerOperationState } from '../../application/WorkerTreeProvider';
import { cursorSeconds } from '../../application/runSelection';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import type { BatchSeries } from '../../domain/run';
import type { WorkerKey } from '../../domain/worker';
import { useViz } from '../../store';
import { batchMetricOption } from '../metrics';

interface BatchCardSpec {
  readonly idx: string;
  readonly title: string;
  readonly metric: 'total_tokens' | 'prefill_tokens' | 'decode_requests';
  readonly caption: string;
}

const CARDS: readonly BatchCardSpec[] = [
  {
    idx: 'd1',
    title: 'Total batch tokens',
    metric: 'total_tokens',
    caption:
      'Total logical tokens in each sampled worker invocation. For FFN this is the routed-token total.',
  },
  {
    idx: 'd2',
    title: 'Prefill tokens',
    metric: 'prefill_tokens',
    caption: 'New prompt tokens processed by each sampled attention or iter-wise invocation.',
  },
  {
    idx: 'd3',
    title: 'Decode requests',
    metric: 'decode_requests',
    caption:
      'Decode sequences participating in each sampled attention or iter-wise invocation; standard one-token decode makes this equal to decode tokens.',
  },
];

function unavailableReason(
  metric: BatchCardSpec['metric'],
  workerKind: 'afd_attn' | 'afd_ffn' | 'iterwise' | null,
): string | null {
  if (metric === 'total_tokens') return null;
  if (workerKind === 'afd_ffn') {
    return 'FFN cost logs retain only routed total tokens; prefill/decode attribution is unavailable.';
  }
  if (workerKind === null) return 'Waiting for prefetched worker-kind metadata.';
  return null;
}

function BatchMetricCard({
  spec,
  batch,
  workerKey,
  cursorMs,
  workerKind,
}: {
  spec: BatchCardSpec;
  batch: BatchSeries;
  workerKey: WorkerKey;
  cursorMs: number | null;
  workerKind: 'afd_attn' | 'afd_ffn' | 'iterwise' | null;
}) {
  const unavailable = unavailableReason(spec.metric, workerKind);
  return (
    <ChartCard
      idx={spec.idx}
      title={spec.title}
      sub={unavailable ? 'unavailable for this worker kind' : `worker: ${workerKey}`}
      option={
        unavailable
          ? null
          : batchMetricOption(batch, spec.metric, CHART_THEME, cursorSeconds({ cursorMs }))
      }
      empty={unavailable ?? undefined}
      note={unavailable ? null : 'selected worker · sampled invocations'}
      caption={spec.caption}
    />
  );
}

/** Three independent worker charts. The operation index supplies worker kind
 * metadata, preventing routed-only FFN zeros from masquerading as composition. */
export default function WorkerBatchComposition({ workerKey }: { workerKey: WorkerKey }) {
  const subject = useActiveRunSubject('batch');
  const operationState = useActiveWorkerOperationState();
  const cursorMs = useViz((state) => state.cursorMs);
  const workerKind =
    operationState.status === 'ready' ? operationState.viewport.buffer.workerKind : null;
  const batch =
    subject.status === 'ready'
      ? subject.payload.workers.find((worker) => worker.key === workerKey)
      : undefined;

  if (!batch) {
    const sub =
      subject.status === 'ready'
        ? 'ready · worker detail unavailable'
        : subjectStatusLabel(subject);
    const empty =
      subject.status === 'ready'
        ? `The batch payload has no series for worker ${workerKey}. Re-run analysis with worker batch publication enabled.`
        : subjectStatusMessage(subject);
    return (
      <ChartCard
        idx="d"
        title="Batch composition"
        sub={sub}
        option={null}
        empty={empty}
        caption="Worker-level sampled batch composition."
      />
    );
  }

  return (
    <Box
      component="section"
      aria-label={`Batch composition · ${workerKey}`}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3,1fr)' }, gap: 2 }}
    >
      {CARDS.map((spec) => (
        <BatchMetricCard
          key={spec.metric}
          spec={spec}
          batch={batch}
          workerKey={workerKey}
          cursorMs={cursorMs}
          workerKind={workerKind}
        />
      ))}
    </Box>
  );
}
