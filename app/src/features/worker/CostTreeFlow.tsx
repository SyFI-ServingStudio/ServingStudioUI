import { useActiveRun } from '../../application/ActiveRunProvider';
import { currentWorker } from '../../application/runSelection';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { useViz } from '../../store';
import type { CostTree } from '../../domain/cost-tree';
import type { WorkerRow } from '../../domain/run';
import CostTreeCanvas from './CostTreeCanvas';
import { CostTreeFrame } from './CostTreeFrame';

const PRODUCTION_CONTROLS = {
  zoomIn: 'Zoom in worker CostTree',
  zoomOut: 'Zoom out worker CostTree',
  fit: 'Fit worker CostTree',
  reset: 'Reset worker CostTree',
} as const;

interface CostTreeEvidenceProps {
  tree: CostTree;
  worker?: WorkerRow | null;
  identity?: { readonly archId: string; readonly archType: string; readonly gpuCount: number };
  timeBasis: string;
  selectedLeafId: number | null;
  selectedParallelId: number | null;
  onSelectLeaf: (leafId: number) => void;
  onSelectParallel: (parallelId: number) => void;
  onSelectRoot: () => void;
  ariaLabel?: string;
}

/** Context-free exact CostTree evidence. Simulation and timing-prediction pages
 * own different identities but intentionally share this visual interaction. */
export function CostTreeEvidence({
  tree,
  worker = null,
  identity,
  timeBasis,
  selectedLeafId,
  selectedParallelId,
  onSelectLeaf,
  onSelectParallel,
  onSelectRoot,
  ariaLabel = 'CostTree canvas',
}: CostTreeEvidenceProps) {
  return (
    <CostTreeFrame worker={worker} identity={identity} timeBasis={timeBasis} totalMs={tree.totalMs}>
      <CostTreeCanvas
        tree={tree}
        selectedLeafId={selectedLeafId}
        selectedParallelId={selectedParallelId}
        onSelectLeaf={onSelectLeaf}
        onSelectParallel={onSelectParallel}
        onSelectRoot={onSelectRoot}
        ariaLabel={ariaLabel}
        controlLabels={PRODUCTION_CONTROLS}
        fillFrame
      />
    </CostTreeFrame>
  );
}

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
    <CostTreeEvidence
      tree={treeState.tree}
      worker={worker}
      timeBasis={timeBasis}
      selectedLeafId={selectedLeafId}
      selectedParallelId={selectedParallelId}
      onSelectLeaf={selectKernel}
      onSelectParallel={selectParallel}
      onSelectRoot={() => selectWorker(worker.ref)}
      ariaLabel="Worker CostTree canvas"
    />
  );
}
