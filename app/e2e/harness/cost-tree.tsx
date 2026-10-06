// Browser-only component fixture: the bundled run has no exact CostTree artifact.
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient } from '../../src/app/queryClient';
import { CostTreeEvidence } from '../../src/panels/CostTreeEvidence';
import { TimeShareBlocksView } from '../../src/panels/TimeShareBlocksView';
import { annotate } from '../../src/panels/costTreeModel';
import { leaf, sum } from '../../src/test/costTreeDsl';
import { theme } from '../../src/ui/theme';

const tree = annotate(
  sum(
    'root',
    leaf('attention.decode', 'flashinfer_attn_decode', {}, 95),
    leaf('attention.prefill', 'flashinfer_attn_prefill', {}, 5),
  ),
);
// What the Analyzer serves beside this tree: a Sum puts both leaves on the path.
const timeShare = {
  kernelTimeMs: 100,
  segments: [
    {
      position: 'attention.decode',
      kind: 'flashinfer_attn_decode',
      kernelTimeMs: 95,
      sharePct: 95,
    },
    {
      position: 'attention.prefill',
      kind: 'flashinfer_attn_prefill',
      kernelTimeMs: 5,
      sharePct: 5,
    },
  ],
};

export function Fixture() {
  const [selectedLeafId, selectLeaf] = useState<number | null>(null);
  // The views read the kernel kinds' DOC names, which the spec serves.
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <CostTreeEvidence
          tree={tree}
          timeShare={timeShare}
          timeBasis="Test operation"
          selectedLeafId={selectedLeafId}
          selectedParallelId={null}
          onSelectLeaf={selectLeaf}
          onSelectParallel={() => {}}
          onSelectRoot={() => selectLeaf(null)}
        />
        <TimeShareBlocksView
          tree={tree}
          timeShare={timeShare}
          selectedLeafId={selectedLeafId}
          onSelectKernel={selectLeaf}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
