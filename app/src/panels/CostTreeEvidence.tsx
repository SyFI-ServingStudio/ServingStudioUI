import { useEffect, useState } from 'react';

import type { CostTree } from './costTreeModel';
import CostTreeCanvas from './CostTreeCanvas';
import { CostTreeFrame } from './CostTreeFrame';

const PRODUCTION_CONTROLS = {
  zoomIn: 'Zoom in worker CostTree',
  zoomOut: 'Zoom out worker CostTree',
  fit: 'Fit worker CostTree',
  reset: 'Reset worker CostTree',
  expand: 'Expand worker CostTree to fill browser',
  collapse: 'Restore worker CostTree layout',
} as const;

interface CostTreeEvidenceProps {
  tree: CostTree;
  worker?: {
    readonly id: string;
    readonly arch: { readonly type: string };
    readonly gpuCount: number;
  } | null;
  identity?: { readonly archId: string; readonly archType: string; readonly gpuCount: number };
  timeBasis: string;
  selectedLeafId: number | null;
  selectedParallelId: number | null;
  onSelectLeaf: (leafId: number) => void;
  onSelectParallel: (parallelId: number) => void;
  onSelectRoot: () => void;
  ariaLabel?: string;
}

/** Context-free exact CostTree evidence shared by run and prediction panels. */
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
  const [browserExpanded, setBrowserExpanded] = useState(false);

  useEffect(() => {
    if (!browserExpanded) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const collapseOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBrowserExpanded(false);
    };
    window.addEventListener('keydown', collapseOnEscape);
    return () => {
      window.removeEventListener('keydown', collapseOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [browserExpanded]);

  return (
    <CostTreeFrame
      worker={worker}
      identity={identity}
      timeBasis={timeBasis}
      totalMs={tree.totalMs}
      browserExpanded={browserExpanded}
    >
      <CostTreeCanvas
        tree={tree}
        selectedLeafId={selectedLeafId}
        selectedParallelId={selectedParallelId}
        onSelectLeaf={onSelectLeaf}
        onSelectParallel={onSelectParallel}
        onSelectRoot={onSelectRoot}
        ariaLabel={ariaLabel}
        controlLabels={PRODUCTION_CONTROLS}
        browserExpansion={{
          expanded: browserExpanded,
          onToggle: () => setBrowserExpanded((expanded) => !expanded),
          expandLabel: PRODUCTION_CONTROLS.expand,
          collapseLabel: PRODUCTION_CONTROLS.collapse,
        }}
        fillFrame
      />
    </CostTreeFrame>
  );
}
