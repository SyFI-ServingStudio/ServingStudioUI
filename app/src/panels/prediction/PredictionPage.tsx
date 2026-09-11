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
import { Fragment, useCallback, useEffect, useMemo } from 'react';

import {
  kernelInputDistributionRef,
  predictionCasesRef,
  predictionCostTreeRef,
  predictionDescriptorRef,
  predictionKernelThroughputAnalysisRef,
  predictionOptimalityKernelLadderRef,
  predictionOptimalityWaterfallRef,
  useArtifact,
  type ArtifactResult,
  type PredictionCase,
  type PredictionDescriptor,
} from '../../artifacts';
import { segmentOf, selectSegment, upTo, withOption, withPanel, withPath } from '../../location';
import type { ResultRef } from '../../location';
import type { PanelProps } from '../types';
import { annotate, fmtMs, leafById, type JsonValue } from '../costTreeModel';
import type { SubjectResult } from '../subjectResult';
import type { OptimalityMode } from '../../artifacts';
import AnalysisPageHeader from '../../ui/controls/AnalysisPageHeader';
import SurfaceCard from '../../ui/controls/SurfaceCard';
import { pageLayout } from '../../ui/theme/metrics';
import { tokens, withAlpha } from '../../ui/theme';
import { CostTreeEvidence } from '../CostTreeEvidence';
import { COST_TREE_FRAME_HEIGHT, CostTreeFrame, CostTreeStatusViewport } from '../CostTreeFrame';
import { KernelEvidenceView, type KernelAnalysisState } from '../KernelEvidenceView';
import { KernelInspectorView } from '../KernelInspectorView';
import { TimeShareBlocksView } from '../TimeShareBlocksView';
import { OptimalityWaterfallCard } from '../shared/OptimalityBreakdownCard';
import OptimalityKernelLadderCard from '../shared/OptimalityKernelLadderCard';
import OptimalityKernelsCard from '../shared/OptimalityKernelsCard';
import { projectIterationOptimalityBreakdown } from '../shared/optimalityBreakdown';
import { projectExactKernelLadder } from '../shared/optimalityKernelLadder';

const CASE_PAGE_SIZE = 64;

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
          sx={{ flexShrink: 0, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}
        >
          iterations
        </Typography>
        <Stack
          direction="row"
          useFlexGap
          flexWrap="wrap"
          sx={{ gap: 0.75, minWidth: 0, maxHeight: 104, overflowY: 'auto', py: 0.25, flex: 1 }}
        >
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
                  border: `1px solid ${selected ? withAlpha(tokens.teal, 0.5) : tokens.hair}`,
                  color: selected ? tokens.teal : tokens.ink,
                  background: selected ? withAlpha(tokens.teal, 0.08) : tokens.tile2,
                  fontFamily: tokens.body,
                  fontSize: 12,
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
          <Typography sx={{ mr: 0.3, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
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
                  border: `1px solid ${selected ? withAlpha(tokens.teal, 0.45) : tokens.hair}`,
                  color: selected ? tokens.teal : tokens.sub,
                  background: selected ? withAlpha(tokens.teal, 0.07) : 'transparent',
                  fontFamily: tokens.body,
                  fontSize: 12,
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

type PredictionResultRef = ResultRef & { readonly kind: 'prediction' };
type SelectionPatch = {
  readonly panelId?: string | null;
  readonly caseId?: string | null;
  readonly operationId?: string | null;
  readonly leafId?: number | null;
  readonly parallelId?: number | null;
  readonly optimalityMode?: OptimalityMode;
};

function resultReason(result: ArtifactResult<unknown>): string {
  return 'reason' in result
    ? (result.reason ?? 'Could not load timing prediction.')
    : 'Could not load timing prediction.';
}

export function PredictionPage(props: PanelProps) {
  if (props.location.ref.kind !== 'prediction') return null;
  return <PredictionContent {...props} result={{ ...props.location.ref, kind: 'prediction' }} />;
}

function PredictionContent({
  location,
  navigate,
  result,
}: PanelProps & { readonly result: PredictionResultRef }) {
  const selectedCaseId = segmentOf(location.focus.path, 'case')?.id;
  const selectedOperationId = segmentOf(location.focus.path, 'caseOperation')?.id;
  const requestedCase = Number(selectedCaseId);
  const caseOffset =
    Number.isSafeInteger(requestedCase) && requestedCase >= 0
      ? Math.floor(requestedCase / CASE_PAGE_SIZE) * CASE_PAGE_SIZE
      : 0;
  const descriptor = useArtifact(predictionDescriptorRef(result));
  const casePage = useArtifact(predictionCasesRef(result, caseOffset, CASE_PAGE_SIZE));

  const updatePredictionSelection = useCallback(
    (patch: SelectionPatch) => {
      let focus = location.focus;
      if (patch.caseId !== undefined) {
        focus =
          patch.caseId === null
            ? withPath(focus, [])
            : selectSegment(focus, { at: 'case', id: patch.caseId });
      }
      if (patch.operationId !== undefined) {
        if (patch.operationId !== null) {
          focus = selectSegment(focus, { at: 'caseOperation', id: patch.operationId });
        } else if (segmentOf(focus.path, 'caseOperation') !== null) {
          focus = upTo(focus, 'case');
        }
      }
      if (patch.leafId !== undefined) {
        if (patch.leafId !== null) {
          focus = selectSegment(focus, { at: 'leaf', id: patch.leafId });
        } else if (segmentOf(focus.path, 'leaf') !== null) {
          focus = upTo(focus, 'caseOperation');
        }
      }
      if (patch.parallelId !== undefined) {
        if (patch.parallelId !== null) {
          focus = selectSegment(focus, { at: 'parallel', id: patch.parallelId });
        } else if (segmentOf(focus.path, 'parallel') !== null) {
          focus = upTo(focus, 'caseOperation');
        }
      }
      if (patch.panelId !== undefined) focus = withPanel(focus, patch.panelId);
      if (patch.optimalityMode !== undefined)
        focus = withOption(focus, 'optimality', patch.optimalityMode);
      navigate({ ...location, focus }, 'replace');
    },
    [location, navigate],
  );

  useEffect(() => {
    if (casePage.status !== 'ready') return;
    const selectedCase = casePage.value.cases.find(
      (candidate) => candidate.caseId === selectedCaseId,
    );
    const selectedOperation = selectedCase?.operations.find(
      (candidate) => candidate.operationId === selectedOperationId,
    );
    if (selectedCase === undefined && casePage.value.cases.length > 0) {
      updatePredictionSelection({
        caseId: casePage.value.cases[0].caseId,
        operationId: null,
        leafId: null,
        parallelId: null,
      });
    } else if (
      selectedCase !== undefined &&
      selectedOperation === undefined &&
      selectedCase.operations.length > 0
    ) {
      updatePredictionSelection({
        operationId: selectedCase.operations[0].operationId,
        leafId: null,
        parallelId: null,
      });
    }
  }, [casePage, selectedCaseId, selectedOperationId, updatePredictionSelection]);

  if (descriptor.status === 'pending' || casePage.status === 'pending') {
    return (
      <Stack sx={{ gap: 1.2 }}>
        <Skeleton variant="rounded" height={58} />
        <Skeleton variant="rounded" height={COST_TREE_FRAME_HEIGHT} />
      </Stack>
    );
  }
  if (descriptor.status !== 'ready' || casePage.status !== 'ready') {
    const failure = descriptor.status !== 'ready' ? descriptor : casePage;
    return (
      <SurfaceCard role="alert" accent={tokens.terra} sx={{ p: 2 }}>
        <Typography sx={{ color: tokens.terra, fontFamily: tokens.body, fontSize: 12 }}>
          {resultReason(failure)}
        </Typography>
      </SurfaceCard>
    );
  }

  const selectedCase = casePage.value.cases.find(
    (candidate) => candidate.caseId === selectedCaseId,
  );
  const selectedOperation = selectedCase?.operations.find(
    (candidate) => candidate.operationId === selectedOperationId,
  );
  return (
    <Stack sx={{ gap: 2, py: 4, ...pageLayout, mx: 'auto' }}>
      <AnalysisPageHeader title="Timing prediction" detail={descriptor.value.displayName} />
      <PredictionCasePicker
        cases={casePage.value.cases}
        selectedCaseId={selectedCaseId}
        selectedOperationId={selectedOperationId}
        offset={casePage.value.offset}
        total={casePage.value.total}
        onSelectCase={(caseId) =>
          updatePredictionSelection({ caseId, operationId: null, leafId: null, parallelId: null })
        }
        onSelectOperation={(operationId) =>
          updatePredictionSelection({ operationId, leafId: null, parallelId: null })
        }
        onPage={(offset) =>
          updatePredictionSelection({
            caseId: String(offset),
            operationId: null,
            leafId: null,
            parallelId: null,
          })
        }
      />
      {selectedCase !== undefined && selectedOperation !== undefined ? (
        <SelectedPrediction
          location={location}
          result={result}
          descriptor={descriptor.value}
          selectedCase={selectedCase}
          selectedOperationId={selectedOperation.operationId}
          updateSelection={updatePredictionSelection}
        />
      ) : (
        <CostTreeFrame
          identity={{
            archId: '0',
            archType: descriptor.value.archType,
            gpuCount: descriptor.value.gpu.count,
          }}
        >
          <CostTreeStatusViewport role="status" busy>
            <Typography sx={{ color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}>
              Loading exact prediction CostTree…
            </Typography>
          </CostTreeStatusViewport>
        </CostTreeFrame>
      )}
    </Stack>
  );
}

function SelectedPrediction({
  location,
  result,
  descriptor,
  selectedCase,
  selectedOperationId,
  updateSelection,
}: {
  readonly location: PanelProps['location'];
  readonly result: PredictionResultRef;
  readonly descriptor: PredictionDescriptor;
  readonly selectedCase: PredictionCase;
  readonly selectedOperationId: string;
  readonly updateSelection: (patch: SelectionPatch) => void;
}) {
  const selectedLeafId = segmentOf(location.focus.path, 'leaf')?.id ?? null;
  const selectedParallelId = segmentOf(location.focus.path, 'parallel')?.id ?? null;
  const optimalityMode: OptimalityMode =
    location.focus.options.optimality === 'batch_locked' ? 'batch_locked' : 'unlocked';
  const costTree = useArtifact(
    predictionCostTreeRef(result, selectedCase.caseId, selectedOperationId),
  );
  const ladder = useArtifact(
    predictionOptimalityKernelLadderRef(result, selectedCase.caseId, optimalityMode),
  );
  const waterfall = useArtifact(
    predictionOptimalityWaterfallRef(result, selectedCase.caseId, optimalityMode),
  );
  const tree = useMemo(
    () => (costTree.status === 'ready' ? annotate(costTree.value.tree) : null),
    [costTree],
  );
  const selectedLeaf = tree === null ? null : leafById(tree, selectedLeafId);
  const selectedKernelName = selectedLeaf?.slot.name ?? null;
  const ladderProjection =
    ladder.status === 'ready'
      ? projectExactKernelLadder(ladder.value, selectedKernelName)
      : {
          status: ladder.status === 'pending' ? ('pending' as const) : ('failed' as const),
          reason:
            ladder.status === 'pending' ? 'Loading prediction optimality.' : resultReason(ladder),
        };
  const waterfallProjection =
    waterfall.status === 'ready'
      ? projectIterationOptimalityBreakdown(waterfall.value)
      : {
          status: waterfall.status === 'pending' ? ('pending' as const) : ('failed' as const),
          reason:
            waterfall.status === 'pending'
              ? 'Loading prediction optimality waterfall.'
              : resultReason(waterfall),
        };
  const evidenceHeader = {
    archId: '0',
    archType: descriptor.archType,
    gpuCount: descriptor.gpu.count,
  };

  let workbench;
  if (costTree.status !== 'ready' || tree === null) {
    const failed = costTree.status !== 'pending';
    workbench = (
      <CostTreeFrame identity={evidenceHeader}>
        <CostTreeStatusViewport role={failed ? 'alert' : 'status'} busy={!failed}>
          <Typography
            sx={{
              color: failed ? tokens.terra : tokens.sub,
              fontFamily: tokens.body,
              fontSize: 12,
            }}
          >
            {failed ? resultReason(costTree) : 'Loading exact prediction CostTree…'}
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
          tree={tree}
          identity={evidenceHeader}
          timeBasis={`iter ${selectedCase.caseId} · operation ${selectedOperationId}`}
          selectedLeafId={selectedLeafId}
          selectedParallelId={selectedParallelId}
          onSelectLeaf={(leafId) =>
            updateSelection({ panelId: 'cost-tree', leafId, parallelId: null })
          }
          onSelectParallel={(parallelId) =>
            updateSelection({ panelId: 'cost-tree', parallelId, leafId: null })
          }
          onSelectRoot={() =>
            updateSelection({ panelId: 'cost-tree', leafId: null, parallelId: null })
          }
          ariaLabel="Timing prediction CostTree canvas"
        />
        {selectedLeaf !== null ? (
          <KernelInspectorView
            node={selectedLeaf}
            height={COST_TREE_FRAME_HEIGHT}
            closeLabel="Close selected prediction kernel"
            onClose={() => updateSelection({ leafId: null })}
          />
        ) : (
          <SurfaceCard
            role="status"
            sx={{ height: COST_TREE_FRAME_HEIGHT, boxSizing: 'border-box', p: 1.7 }}
          >
            <Typography sx={{ fontFamily: tokens.serif, fontSize: 15, fontWeight: 600 }}>
              Select a kernel
            </Typography>
            <Typography sx={{ mt: 0.45, color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}>
              Select a CostTree leaf to inspect exact input, backend, and modeled performance.
            </Typography>
          </SurfaceCard>
        )}
      </Box>
    );
  }

  return (
    <Fragment>
      {workbench}
      {tree !== null && selectedLeaf !== null && (
        <PredictionKernelEvidence
          result={result}
          descriptor={descriptor}
          caseId={selectedCase.caseId}
          operationId={selectedOperationId}
          leafId={selectedLeafId!}
          node={selectedLeaf}
        />
      )}
      {tree !== null && (
        <TimeShareBlocksView
          tree={tree}
          selectedLeafId={selectedLeafId}
          onSelectKernel={(leafId) =>
            updateSelection({ panelId: 'kernel-time-share', leafId, parallelId: null })
          }
        />
      )}
      <Stack direction="row" justifyContent="flex-end">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={optimalityMode}
          onChange={(_event, nextMode: OptimalityMode | null) => {
            if (nextMode !== null) updateSelection({ optimalityMode: nextMode });
          }}
          aria-label="Prediction optimality batch-size mode"
          sx={{
            '& .MuiToggleButton-root': {
              px: 1,
              py: 0.2,
              fontFamily: tokens.body,
              fontSize: 12,
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
        title={`Optimality waterfall · iter ${selectedCase.caseId}`}
        projection={waterfallProjection}
        evidence={{
          evidenceId: 'optimality-breakdown',
          selectedForAgent: location.focus.panel === 'optimality-breakdown',
          onEvidenceSelect: () => updateSelection({ panelId: 'optimality-breakdown' }),
        }}
      />
      <OptimalityKernelLadderCard
        idx="b"
        title={
          selectedKernelName === null
            ? `Kernel optimality ladder · iter ${selectedCase.caseId}`
            : `Kernel optimality ladder · ${selectedKernelName}`
        }
        projection={ladderProjection}
        evidence={{
          evidenceId: 'optimality-kernel-ladder',
          selectedForAgent: location.focus.panel === 'optimality-kernel-ladder',
          onEvidenceSelect: () => updateSelection({ panelId: 'optimality-kernel-ladder' }),
        }}
      />
      <OptimalityKernelsCard
        idx="c"
        title={
          selectedKernelName === null
            ? `Per-kernel optimality · iter ${selectedCase.caseId}`
            : `Kernel optimality sources · ${selectedKernelName}`
        }
        projection={ladderProjection}
        evidence={{
          evidenceId: 'optimality-kernels',
          selectedForAgent: location.focus.panel === 'optimality-kernels',
          onEvidenceSelect: () => updateSelection({ panelId: 'optimality-kernels' }),
        }}
      />
    </Fragment>
  );
}

function PredictionKernelEvidence({
  result,
  descriptor,
  caseId,
  operationId,
  leafId,
  node,
}: {
  readonly result: PredictionResultRef;
  readonly descriptor: PredictionDescriptor;
  readonly caseId: string;
  readonly operationId: string;
  readonly leafId: number;
  readonly node: NonNullable<ReturnType<typeof leafById>>;
}) {
  const analysisResult = useArtifact(
    predictionKernelThroughputAnalysisRef(result, caseId, operationId, leafId),
  );
  const analysis: KernelAnalysisState =
    analysisResult.status === 'ready'
      ? { data: analysisResult.value, supported: true, isError: false }
      : {
          supported: analysisResult.status !== 'unavailable',
          isError: analysisResult.status === 'failed',
          evidenceStatus: analysisResult.status === 'pending' ? 'loading' : analysisResult.status,
          reason: analysisResult.status === 'pending' ? undefined : resultReason(analysisResult),
        };
  if (!descriptor.kernelInputDistributionAvailable) {
    const subject: SubjectResult<'kernelInputDistribution'> = {
      subject: 'kernelInputDistribution',
      status: 'not_generated',
      reason: 'This prediction has no input-distribution analysis.',
    };
    return <KernelEvidenceView node={node} analysis={analysis} distributionSubject={subject} />;
  }
  return (
    <PredictionKernelEvidenceWithDistribution result={result} node={node} analysis={analysis} />
  );
}

function PredictionKernelEvidenceWithDistribution({
  result,
  node,
  analysis,
}: {
  readonly result: PredictionResultRef;
  readonly node: NonNullable<ReturnType<typeof leafById>>;
  readonly analysis: KernelAnalysisState;
}) {
  const distribution = useArtifact(kernelInputDistributionRef(result));
  let subject: SubjectResult<'kernelInputDistribution'>;
  if (distribution.status === 'ready')
    subject = {
      subject: 'kernelInputDistribution',
      status: 'ready',
      schemaVersion: distribution.schemaVersion,
      payload: distribution.value,
    };
  else if (distribution.status === 'pending')
    subject = {
      subject: 'kernelInputDistribution',
      status: 'pending',
      reason: 'Loading prediction input distribution.',
    };
  else if (distribution.status === 'not_generated')
    subject = {
      subject: 'kernelInputDistribution',
      status: 'not_generated',
      reason: distribution.reason,
    };
  else if (distribution.status === 'unavailable')
    subject = {
      subject: 'kernelInputDistribution',
      status: 'unavailable',
      reason: distribution.reason,
      code: distribution.code,
    };
  else if (distribution.status === 'incompatible')
    subject = {
      subject: 'kernelInputDistribution',
      status: 'incompatible',
      reason: distribution.reason,
      receivedSchemaVersion: distribution.received,
    };
  else
    subject = {
      subject: 'kernelInputDistribution',
      status: 'failed',
      code: distribution.code,
      reason: distribution.reason,
    };
  return <KernelEvidenceView node={node} analysis={analysis} distributionSubject={subject} />;
}
