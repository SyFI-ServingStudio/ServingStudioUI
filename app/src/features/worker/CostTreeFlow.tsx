import { useActiveRun } from '../../application/ActiveRunProvider';
import { currentWorker } from '../../application/runSelection';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { useViz } from '../../store';
import CostTreeCanvas from './CostTreeCanvas';
import { CostTreeFrame } from './CostTreeFrame';

const PRODUCTION_CONTROLS = {
  zoomIn: 'Zoom in worker CostTree',
  zoomOut: 'Zoom out worker CostTree',
  fit: 'Fit worker CostTree',
  reset: 'Reset worker CostTree',
} as const;

export default function CostTreeFlow() {
  const scope = useViz((state) => state.scope);
  const workerKey = useViz((state) => state.workerKey);
  const leafId = useViz((state) => state.leafId);
  const parId = useViz((state) => state.parId);
  const selectWorker = useViz((state) => state.selectWorker);
  const selectKernel = useViz((state) => state.selectKernel);
  const selectParallel = useViz((state) => state.selectParallel);
  const operation = useViz((state) => state.operation);
  const run = useActiveRun();
  const worker = currentWorker(run, { workerKey });
  const treeState = useActiveWorkerTreeState();
  if (treeState.status !== 'ready') {
    throw new Error(`CostTreeFlow requires ready worker evidence, received ${treeState.status}.`);
  }
  const selectedLeafId = scope === 'kernel' ? leafId : null;
  const selectedParallelId = scope === 'parallel' ? parId : null;
  const timeBasis = operation
    ? `iter ${operation.iterId} · batch ${operation.batchId} · operation ${operation.operationId}`
    : 'exact operation';

  return (
    <CostTreeFrame worker={worker} timeBasis={timeBasis} totalMs={treeState.tree.totalMs}>
      <CostTreeCanvas
        tree={treeState.tree}
        selectedLeafId={selectedLeafId}
        selectedParallelId={selectedParallelId}
        onSelectLeaf={selectKernel}
        onSelectParallel={selectParallel}
        onSelectRoot={() => selectWorker(worker.ref)}
        ariaLabel="Worker CostTree canvas"
        controlLabels={PRODUCTION_CONTROLS}
        fillFrame
      />
    </CostTreeFrame>
  );
}
