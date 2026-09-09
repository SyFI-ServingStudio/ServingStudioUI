import { ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useViz, type WorkerAnalysisLevel } from '../../store';
import { tokens } from '../../theme';

/** Explicit worker-detail grain. Operation buffers are prefetched by the
 * provider, while exact CostTree/optimality requests remain selection-driven. */
export default function WorkerAnalysisLevelControl() {
  const level = useViz((state) => state.workerAnalysisLevel);
  const showWorkerAnalysis = useViz((state) => state.showWorkerAnalysis);
  const showIterationAnalysis = useViz((state) => state.showIterationAnalysis);

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={level}
      onChange={(_, nextLevel: WorkerAnalysisLevel | null) => {
        if (nextLevel === 'worker') showWorkerAnalysis();
        if (nextLevel === 'iteration') showIterationAnalysis();
      }}
      aria-label="Worker analysis level"
      sx={{
        flexShrink: 0,
        '& .MuiToggleButton-root': {
          px: 1,
          py: 0.2,
          fontFamily: tokens.body,
          fontSize: 12,
          lineHeight: 1.45,
          color: tokens.sub,
          borderColor: tokens.hair,
          whiteSpace: 'nowrap',
          '&.Mui-selected': { color: tokens.teal, backgroundColor: tokens.tile2 },
        },
      }}
    >
      <ToggleButton value="worker">Worker</ToggleButton>
      <ToggleButton value="iteration">Iteration</ToggleButton>
    </ToggleButtonGroup>
  );
}
