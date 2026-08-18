import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import {
  Box,
  ButtonBase,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  usePredictionCasesQuery,
  usePredictionCostTreeQuery,
  usePredictionDescriptorQuery,
  usePredictionKernelAnalysisQuery,
  usePredictionKernelInputDistributionQuery,
  usePredictionOptimalityQueries,
} from '../../application/queries';
import { workspaceIdFromLocation } from '../../application/workspaceRoute';
import SurfaceCard from '../../components/SurfaceCard';
import { fmtMs, leafById, type JsonValue } from '../../domain/cost-tree';
import type { PredictionAnalyzerSelectionV2 } from '../../domain/analyzerSelection';
import {
  ANALYZER_NAVIGATION_RESULT_EVENT,
  analyzerEvidenceHref,
  evidenceRefFromHash,
  replaceAnalyzerEvidenceHref,
} from '../../domain/analyzerNavigation';
import type { OptimalityMode } from '../../domain/optimality';
import type { PredictionCase } from '../../domain/prediction';
import type { SubjectResult } from '../../domain/subject';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import { KernelEvidenceView, KernelInspectorView } from '../kernel';
import {
  OptimalityKernelLadderCard,
  OptimalityKernelsCard,
  OptimalityWaterfallCard,
  projectExactKernelLadder,
  projectIterationOptimalityBreakdown,
} from '../optimality';
import { CostTreeEvidence } from '../worker/CostTreeFlow';
import {
  COST_TREE_FRAME_HEIGHT,
  CostTreeFrame,
  CostTreeStatusViewport,
} from '../worker/CostTreeFrame';
import { TimeShareBlocksView } from '../worker/TimeShareBlocks';

const CASE_PAGE_SIZE = 64;

function PredictionSelectionUrlSync({ predictionId }: { predictionId: string }) {
  const selection = useViz((state) =>
    state.predictionSelection?.predictionId === predictionId ? state.predictionSelection : null,
  );
  useEffect(() => {
    if (selection === null) return;
    replaceAnalyzerEvidenceHref({ protocol: 'vibesim.analyzer/v2', ...selection });
  }, [selection]);
  return null;
}

function scalarLabel(value: JsonValue): string | null {
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return null;
}

function caseInputLabel(input: JsonValue): string {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return scalarLabel(input) ?? 'structured input';
  }
  const inputRecord = input as Readonly<Record<string, JsonValue>>;
  const groups = inputRecord.groups;
  if (Array.isArray(groups) && groups.length === 1) {
    const group = groups[0];
    if (group !== null && typeof group === 'object' && !Array.isArray(group)) {
      const pairs = group.prefill_chunk_pairs;
      if (
        Array.isArray(pairs) &&
        pairs.length === 1 &&
        Array.isArray(pairs[0]) &&
        pairs[0].length === 2
      ) {
        return `prefill ${String(pairs[0][0])} → ${String(pairs[0][1])}`;
      }
      if (typeof group.decode_count === 'number') {
        const average =
          typeof group.average_decode_length === 'number'
            ? ` · avg ${group.average_decode_length.toLocaleString()}`
            : '';
        return `decode ${group.decode_count.toLocaleString()}${average}`;
      }
    }
  }
  const entries = Object.entries(inputRecord).flatMap(([key, value]) => {
    const label = scalarLabel(value);
    return label === null ? [] : [`${key} ${label}`];
  });
  return entries.slice(0, 3).join(' · ') || 'structured input';
}

function PredictionCasePicker({
  cases,
  selectedCaseId,
  selectedOperationId,
  offset,
  total,
  onSelectCase,
  onSelectOperation,
  onPage,
}: {
  cases: readonly PredictionCase[];
  selectedCaseId: string | undefined;
  selectedOperationId: string | undefined;
  offset: number;
  total: number;
  onSelectCase: (caseId: string) => void;
  onSelectOperation: (operationId: string) => void;
  onPage: (offset: number) => void;
}) {
  const selectedCase = cases.find((candidate) => candidate.caseId === selectedCaseId);
  const hasPrevious = offset > 0;
  const hasNext = offset + cases.length < total;
  return (
    <SurfaceCard
      component="section"
      aria-label="Timing prediction iteration picker"
      sx={{ p: 1.2 }}
    >
      <Stack direction="row" alignItems="center" sx={{ gap: 0.8, minHeight: 31 }}>
        <Typography
          sx={{ flexShrink: 0, fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2 }}
        >
          iterations
        </Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ gap: 0.55, minWidth: 0 }}>
          {cases.map((predictionCase) => {
            const selected = predictionCase.caseId === selectedCaseId;
            return (
              <ButtonBase
                key={predictionCase.caseId}
                aria-pressed={selected}
                onClick={() => onSelectCase(predictionCase.caseId)}
                sx={{
                  minHeight: 29,
                  px: 0.9,
                  gap: 0.65,
                  borderRadius: 0.75,
                  border: `1px solid ${selected ? 'rgba(31,111,107,.5)' : tokens.hair}`,
                  color: selected ? tokens.teal : tokens.ink,
                  background: selected ? 'rgba(31,111,107,.08)' : tokens.tile2,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  transition: `background-color .16s ${tokens.ease}, border-color .16s ${tokens.ease}`,
                }}
              >
                <Box component="span" sx={{ color: selected ? tokens.teal : tokens.sub2 }}>
                  iter {predictionCase.caseId}
                </Box>
                <Box component="span">{caseInputLabel(predictionCase.input)}</Box>
                <Box component="span" sx={{ color: tokens.sub }}>
                  {fmtMs(predictionCase.totalTimeMs)}
                </Box>
              </ButtonBase>
            );
          })}
        </Stack>
        {(hasPrevious || hasNext) && (
          <Stack direction="row" sx={{ ml: 'auto', flexShrink: 0, gap: 0.25 }}>
            <ButtonBase
              aria-label="Previous prediction iterations"
              disabled={!hasPrevious}
              onClick={() => onPage(Math.max(0, offset - CASE_PAGE_SIZE))}
              sx={{ p: 0.35, color: tokens.sub, '&.Mui-disabled': { opacity: 0.3 } }}
            >
              <ChevronLeftRounded sx={{ fontSize: 17 }} />
            </ButtonBase>
            <ButtonBase
              aria-label="Next prediction iterations"
              disabled={!hasNext}
              onClick={() => onPage(offset + CASE_PAGE_SIZE)}
              sx={{ p: 0.35, color: tokens.sub, '&.Mui-disabled': { opacity: 0.3 } }}
            >
              <ChevronRightRounded sx={{ fontSize: 17 }} />
            </ButtonBase>
          </Stack>
        )}
      </Stack>
      {selectedCase !== undefined && selectedCase.operations.length > 1 && (
        <Stack
          direction="row"
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
          sx={{ gap: 0.45, mt: 0.8, pt: 0.8, borderTop: `1px solid ${tokens.hair}` }}
        >
          <Typography sx={{ mr: 0.3, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
            operations
          </Typography>
          {selectedCase.operations.map((operation) => {
            const selected = operation.operationId === selectedOperationId;
            return (
              <ButtonBase
                key={operation.operationId}
                aria-pressed={selected}
                onClick={() => onSelectOperation(operation.operationId)}
                sx={{
                  px: 0.75,
                  py: 0.32,
                  borderRadius: 0.65,
                  border: `1px solid ${selected ? 'rgba(31,111,107,.45)' : tokens.hair}`,
                  color: selected ? tokens.teal : tokens.sub,
                  background: selected ? 'rgba(31,111,107,.07)' : 'transparent',
                  fontFamily: tokens.mono,
                  fontSize: 9,
                }}
              >
                {operation.section} · layer {operation.layer} · {fmtMs(operation.timeMs)}
              </ButtonBase>
            );
          })}
        </Stack>
      )}
    </SurfaceCard>
  );
}

function nonReadySubject(
  status: 'pending' | 'not_generated' | 'failed',
  reason: string,
): SubjectResult<'kernelInputDistribution'> {
  if (status === 'failed') {
    return {
      subject: 'kernelInputDistribution',
      status,
      code: 'prediction_subject_failed',
      reason,
    };
  }
  return { subject: 'kernelInputDistribution', status, reason };
}

export default function PredictionPage({ predictionId }: { predictionId: string }) {
  const navigationTarget = useMemo(() => {
    const target = evidenceRefFromHash(window.location.hash);
    return target?.kind === 'prediction' && target.predictionId === predictionId ? target : null;
  }, [predictionId]);
  const [caseOffset, setCaseOffset] = useState(() => {
    const requestedCase = Number(navigationTarget?.caseId);
    return Number.isInteger(requestedCase) && requestedCase >= 0
      ? Math.floor(requestedCase / CASE_PAGE_SIZE) * CASE_PAGE_SIZE
      : 0;
  });
  const workspaceId = workspaceIdFromLocation();
  const selectedCaseId = useViz((state) =>
    state.predictionSelection?.predictionId === predictionId
      ? (state.predictionSelection.caseId ?? undefined)
      : undefined,
  );
  const selectedOperationId = useViz((state) =>
    state.predictionSelection?.predictionId === predictionId
      ? (state.predictionSelection.operationId ?? undefined)
      : undefined,
  );
  const selectedLeafId = useViz((state) =>
    state.predictionSelection?.predictionId === predictionId
      ? state.predictionSelection.leafId
      : null,
  );
  const selectedParallelId = useViz((state) =>
    state.predictionSelection?.predictionId === predictionId
      ? state.predictionSelection.parallelId
      : null,
  );
  const optimalityMode = useViz((state) =>
    state.predictionSelection?.predictionId === predictionId
      ? state.predictionSelection.optimalityMode
      : 'unlocked',
  );
  const setPredictionSelection = useViz((state) => state.setPredictionSelection);
  const updatePredictionSelection = useCallback(
    (
      patch: Partial<Omit<PredictionAnalyzerSelectionV2, 'kind' | 'workspaceId' | 'predictionId'>>,
    ) => {
      const current = useViz.getState().predictionSelection;
      setPredictionSelection({
        kind: 'prediction',
        workspaceId,
        predictionId,
        panelId: null,
        caseId: null,
        operationId: null,
        leafId: null,
        parallelId: null,
        optimalityMode: 'unlocked',
        ...(current?.predictionId === predictionId ? current : {}),
        ...patch,
      });
    },
    [predictionId, setPredictionSelection, workspaceId],
  );
  const descriptor = usePredictionDescriptorQuery(predictionId);
  const casePage = usePredictionCasesQuery(predictionId, caseOffset, CASE_PAGE_SIZE);
  const selectedCase = casePage.data?.cases.find(
    (candidate) => candidate.caseId === selectedCaseId,
  );
  const selectedOperation = selectedCase?.operations.find(
    (candidate) => candidate.operationId === selectedOperationId,
  );
  const costTree = usePredictionCostTreeQuery(predictionId, selectedCaseId, selectedOperationId);
  const kernelAnalysis = usePredictionKernelAnalysisQuery(
    predictionId,
    selectedCaseId,
    selectedOperationId,
    selectedLeafId,
  );
  const inputDistribution = usePredictionKernelInputDistributionQuery(
    predictionId,
    descriptor.data?.kernelInputDistributionAvailable === true,
  );
  const optimality = usePredictionOptimalityQueries(predictionId, selectedCaseId, optimalityMode);

  useEffect(() => {
    const current = useViz.getState().predictionSelection;
    if (navigationTarget !== null) {
      const { protocol: _protocol, ...selection } = navigationTarget;
      if (JSON.stringify(current) !== JSON.stringify(selection)) {
        setPredictionSelection(selection);
      }
      return;
    }
    if (current?.predictionId === predictionId && current.workspaceId === workspaceId) return;
    setPredictionSelection({
      kind: 'prediction',
      workspaceId,
      predictionId,
      panelId: null,
      caseId: null,
      operationId: null,
      leafId: null,
      parallelId: null,
      optimalityMode: 'unlocked',
    });
  }, [navigationTarget, predictionId, setPredictionSelection, workspaceId]);

  useEffect(() => {
    const cases = casePage.data?.cases;
    if (cases === undefined || cases.length === 0) return;
    if (!cases.some((candidate) => candidate.caseId === selectedCaseId)) {
      updatePredictionSelection({
        caseId: cases[0].caseId,
        operationId: null,
        leafId: null,
        parallelId: null,
      });
    }
  }, [casePage.data, selectedCaseId, updatePredictionSelection]);

  useEffect(() => {
    if (selectedCase === undefined || selectedCase.operations.length === 0) return;
    if (
      !selectedCase.operations.some((operation) => operation.operationId === selectedOperationId)
    ) {
      updatePredictionSelection({
        operationId: selectedCase.operations[0].operationId,
        leafId: null,
        parallelId: null,
      });
    }
  }, [selectedCase, selectedOperationId, updatePredictionSelection]);

  const selectedLeaf =
    costTree.data === undefined ? null : leafById(costTree.data.tree, selectedLeafId);
  const distributionSubject = useMemo<SubjectResult<'kernelInputDistribution'>>(() => {
    if (descriptor.data?.kernelInputDistributionAvailable !== true) {
      return nonReadySubject(
        'not_generated',
        'This prediction has no input-distribution analysis.',
      );
    }
    if (inputDistribution.data !== undefined) return inputDistribution.data;
    if (inputDistribution.isError) {
      return nonReadySubject(
        'failed',
        inputDistribution.error instanceof Error
          ? inputDistribution.error.message
          : 'Could not load prediction input distribution.',
      );
    }
    return nonReadySubject('pending', 'Loading prediction input distribution.');
  }, [descriptor.data, inputDistribution.data, inputDistribution.error, inputDistribution.isError]);

  const selectedKernelName = selectedLeaf?.slot.name ?? null;
  const ladderProjection = optimality.ladder.data
    ? projectExactKernelLadder(optimality.ladder.data, selectedKernelName)
    : {
        status: optimality.ladder.isError ? ('failed' as const) : ('pending' as const),
        reason: optimality.ladder.isError
          ? optimality.ladder.error instanceof Error
            ? optimality.ladder.error.message
            : 'Could not load prediction optimality.'
          : 'Loading prediction optimality.',
      };
  const waterfallProjection = optimality.waterfall.data
    ? projectIterationOptimalityBreakdown(optimality.waterfall.data)
    : {
        status: optimality.waterfall.isError ? ('failed' as const) : ('pending' as const),
        reason: optimality.waterfall.isError
          ? optimality.waterfall.error instanceof Error
            ? optimality.waterfall.error.message
            : 'Could not load prediction optimality waterfall.'
          : 'Loading prediction optimality waterfall.',
      };

  useEffect(() => {
    if (navigationTarget === null || descriptor.data === undefined || casePage.data === undefined) {
      return;
    }
    const requestedCaseExists =
      navigationTarget.caseId === null ||
      casePage.data.cases.some((candidate) => candidate.caseId === navigationTarget.caseId);
    if (!requestedCaseExists) {
      window.dispatchEvent(
        new CustomEvent(ANALYZER_NAVIGATION_RESULT_EVENT, {
          detail: { href: analyzerEvidenceHref(navigationTarget), status: 'not-found' },
        }),
      );
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const panel = navigationTarget.panelId
        ? (Array.from(document.querySelectorAll<HTMLElement>('[data-evidence-id]')).find(
            (element) => element.dataset.evidenceId === `panel:${navigationTarget.panelId}`,
          ) ?? null)
        : null;
      if (panel !== null) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
      window.dispatchEvent(
        new CustomEvent(ANALYZER_NAVIGATION_RESULT_EVENT, {
          detail: {
            href: analyzerEvidenceHref(navigationTarget),
            status: navigationTarget.panelId === null || panel !== null ? 'ok' : 'not-found',
          },
        }),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [casePage.data, descriptor.data, navigationTarget]);

  if (!descriptor.supported || !casePage.supported) {
    return (
      <Typography sx={{ color: tokens.sub }}>Timing prediction requires live Analyzer.</Typography>
    );
  }
  if (descriptor.isError || casePage.isError) {
    const error = descriptor.error ?? casePage.error;
    return (
      <SurfaceCard role="alert" accent={tokens.terra} sx={{ p: 2 }}>
        <Typography sx={{ color: tokens.terra, fontFamily: tokens.mono, fontSize: 11 }}>
          {error instanceof Error ? error.message : 'Could not load timing prediction.'}
        </Typography>
      </SurfaceCard>
    );
  }
  if (descriptor.data === undefined || casePage.data === undefined) {
    return (
      <Stack sx={{ gap: 1.2 }}>
        <Skeleton variant="rounded" height={58} />
        <Skeleton variant="rounded" height={COST_TREE_FRAME_HEIGHT} />
      </Stack>
    );
  }

  const evidenceHeader = {
    archId: '0',
    archType: descriptor.data.archType,
    gpuCount: descriptor.data.gpu.count,
  };
  let workbench;
  if (costTree.isError) {
    workbench = (
      <CostTreeFrame identity={evidenceHeader}>
        <CostTreeStatusViewport role="alert">
          <Typography sx={{ color: tokens.terra, fontFamily: tokens.mono, fontSize: 11 }}>
            {costTree.error instanceof Error ? costTree.error.message : 'Could not load CostTree.'}
          </Typography>
        </CostTreeStatusViewport>
      </CostTreeFrame>
    );
  } else if (
    costTree.data === undefined ||
    selectedCase === undefined ||
    selectedOperation === undefined
  ) {
    workbench = (
      <CostTreeFrame identity={evidenceHeader}>
        <CostTreeStatusViewport role="status" busy>
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 11 }}>
            Loading exact prediction CostTree…
          </Typography>
        </CostTreeStatusViewport>
      </CostTreeFrame>
    );
  } else {
    workbench = (
      <Box
        sx={{
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) clamp(300px,26vw,340px)' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        <CostTreeEvidence
          tree={costTree.data.tree}
          identity={evidenceHeader}
          timeBasis={`iter ${selectedCase.caseId} · operation ${selectedOperation.operationId}`}
          selectedLeafId={selectedLeafId}
          selectedParallelId={selectedParallelId}
          onSelectLeaf={(leafId) => {
            updatePredictionSelection({
              panelId: 'cost-tree',
              leafId,
              parallelId: null,
            });
          }}
          onSelectParallel={(parallelId) => {
            updatePredictionSelection({
              panelId: 'cost-tree',
              parallelId,
              leafId: null,
            });
          }}
          onSelectRoot={() => {
            updatePredictionSelection({
              panelId: 'cost-tree',
              leafId: null,
              parallelId: null,
            });
          }}
          ariaLabel="Timing prediction CostTree canvas"
        />
        {selectedLeaf !== null ? (
          <KernelInspectorView
            node={selectedLeaf}
            height={COST_TREE_FRAME_HEIGHT}
            closeLabel="Close selected prediction kernel"
            onClose={() => updatePredictionSelection({ leafId: null })}
          />
        ) : (
          <SurfaceCard
            role="status"
            sx={{ height: COST_TREE_FRAME_HEIGHT, boxSizing: 'border-box', p: 1.7 }}
          >
            <Typography sx={{ fontFamily: tokens.serif, fontSize: 15, fontWeight: 600 }}>
              Select a kernel
            </Typography>
            <Typography sx={{ mt: 0.45, color: tokens.sub, fontFamily: tokens.mono, fontSize: 10 }}>
              Select a CostTree leaf to inspect exact input, backend, and modeled performance.
            </Typography>
          </SurfaceCard>
        )}
      </Box>
    );
  }

  return (
    <Stack sx={{ gap: 2 }}>
      <PredictionSelectionUrlSync predictionId={predictionId} />
      <PredictionCasePicker
        cases={casePage.data.cases}
        selectedCaseId={selectedCaseId}
        selectedOperationId={selectedOperationId}
        offset={casePage.data.offset}
        total={casePage.data.total}
        onSelectCase={(caseId) =>
          updatePredictionSelection({
            caseId,
            operationId: null,
            leafId: null,
            parallelId: null,
          })
        }
        onSelectOperation={(operationId) =>
          updatePredictionSelection({
            operationId,
            leafId: null,
            parallelId: null,
          })
        }
        onPage={setCaseOffset}
      />
      {workbench}
      {costTree.data !== undefined && selectedLeaf !== null && (
        <KernelEvidenceView
          node={selectedLeaf}
          analysis={kernelAnalysis}
          distributionSubject={distributionSubject}
        />
      )}
      {costTree.data !== undefined && (
        <TimeShareBlocksView
          tree={costTree.data.tree}
          selectedLeafId={selectedLeafId}
          onSelectKernel={(leafId) => {
            updatePredictionSelection({
              panelId: 'kernel-time-share',
              leafId,
              parallelId: null,
            });
          }}
        />
      )}
      <Stack direction="row" justifyContent="flex-end">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={optimalityMode}
          onChange={(_event, nextMode: OptimalityMode | null) => {
            if (nextMode !== null) updatePredictionSelection({ optimalityMode: nextMode });
          }}
          aria-label="Prediction optimality batch-size mode"
          sx={{
            '& .MuiToggleButton-root': {
              px: 1,
              py: 0.2,
              fontFamily: tokens.mono,
              fontSize: 9.5,
              lineHeight: 1.45,
              color: tokens.sub,
              borderColor: tokens.hair,
              '&.Mui-selected': { color: tokens.teal, backgroundColor: tokens.tile2 },
            },
          }}
        >
          <ToggleButton value="unlocked">Batch unlocked</ToggleButton>
          <ToggleButton value="batch_locked">Batch locked</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <OptimalityWaterfallCard
        idx="a"
        title={`Optimality waterfall · iter ${selectedCaseId ?? '—'}`}
        projection={waterfallProjection}
      />
      <OptimalityKernelLadderCard
        idx="b"
        title={
          selectedKernelName === null
            ? `Kernel optimality ladder · iter ${selectedCaseId ?? '—'}`
            : `Kernel optimality ladder · ${selectedKernelName}`
        }
        projection={ladderProjection}
      />
      <OptimalityKernelsCard
        idx="c"
        title={
          selectedKernelName === null
            ? `Per-kernel optimality · iter ${selectedCaseId ?? '—'}`
            : `Kernel optimality sources · ${selectedKernelName}`
        }
        projection={ladderProjection}
      />
    </Stack>
  );
}
