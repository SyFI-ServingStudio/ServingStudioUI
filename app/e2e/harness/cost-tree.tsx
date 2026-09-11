// Browser-only component fixture: the bundled run has no exact CostTree artifact.
import { CssBaseline, ThemeProvider } from '@mui/material';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CostTreeEvidence } from '../../src/panels/CostTreeEvidence';
import { TimeShareBlocksView } from '../../src/panels/TimeShareBlocksView';
import { annotate, leaf, sum } from '../../src/panels/costTreeModel';
import { theme } from '../../src/ui/theme';

const tree = annotate(
  sum(
    'root',
    leaf('attention.decode', 'flashinfer_attn_decode', {}, 95),
    leaf('attention.prefill', 'flashinfer_attn_prefill', {}, 5),
  ),
);

export function Fixture() {
  const [selectedLeafId, selectLeaf] = useState<number | null>(null);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <CostTreeEvidence
        tree={tree}
        timeBasis="Test operation"
        selectedLeafId={selectedLeafId}
        selectedParallelId={null}
        onSelectLeaf={selectLeaf}
        onSelectParallel={() => {}}
        onSelectRoot={() => selectLeaf(null)}
      />
      <TimeShareBlocksView
        tree={tree}
        selectedLeafId={selectedLeafId}
        onSelectKernel={selectLeaf}
      />
    </ThemeProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
