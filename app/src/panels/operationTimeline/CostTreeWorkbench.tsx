import { Box, Button, Paper, Typography, useMediaQuery } from '@mui/material';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import {
  kernelInputDistributionRef,
  kernelThroughputAnalysisRef,
  topologyRef,
  useArtifact,
  useArtifactWithRetry,
  workerCostTreeRef,
  type ArtifactResult,
  type KernelInputDistribution,
  type KernelThroughputAnalysis,
  type RunDescriptor,
  type RunResultRef,
  type ReadySubjectArtifact,
  type SubjectArtifact,
  type WorkerCostTreeDetail,
} from '../../artifacts';
import {
  annotate,
  leafById,
  nodeById,
  nodeByOrdinalPath,
  nodeOrdinalPath,
  type LeafNode,
} from '../costTreeModel';
import type { SubjectResult } from '../subjectResult';
import { segmentOf, selectSegment, upTo, withOption, withPanel } from '../../location';
import { CostTreeEvidence } from '../CostTreeEvidence';
import { KernelInspectorView } from '../KernelInspectorView';
import { KernelEvidenceView, type KernelAnalysisState } from '../KernelEvidenceView';
import { ParallelDetailView } from '../ParallelDetailView';
import { TimeShareBlocksView } from '../TimeShareBlocksView';
import ScopedOptimalityCard from '../ScopedOptimalityCard';
import {
  COST_TREE_FRAME_HEIGHT,
  WORKER_WORKBENCH_HEIGHT,
  WORKER_WORKBENCH_HEIGHT_VAR,
  CostTreeFrame,
  CostTreeStatusViewport,
} from '../CostTreeFrame';
import type { PanelProps } from '../types';
import { tokens } from '../../ui/theme';

const WORKER_WORKBENCH_MIN_HEIGHT = 480;
const WORKER_VIEWPORT_SAFE_GAP = 12;
const WORKER_VIEWPORT_HEIGHT_VAR = '--worker-viewport-height';
const WORKER_WORKBENCH_MIN_HEIGHT_VAR = '--worker-workbench-min-height';
const WORKER_WORKBENCH_MAX_HEIGHT_VAR = '--worker-workbench-max-height';

type RunLocation = PanelProps['location'] & { readonly ref: RunResultRef };
type Navigate = PanelProps['navigate'];
type DescriptorResult = ArtifactResult<RunDescriptor>;
type DistributionSubject = SubjectResult<'kernelInputDistribution'>;

interface CostTreeIdentity {
  readonly archId: string;
  readonly archType: string;
  readonly gpuCount: number;
}

function pageScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function shellScrollBlock(shell: HTMLElement): ScrollLogicalPosition {
  const renderedHeight = Math.max(shell.getBoundingClientRect().height, shell.scrollHeight);
  return renderedHeight <= window.innerHeight ? 'center' : 'start';
}

function shellIsFullyVisible(shell: HTMLElement): boolean {
  const bounds = shell.getBoundingClientRect();
  return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
}

function workerViewportOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest<HTMLElement>('[data-testid="worker-viewport-shell"]') ?? null;
}

function distributionSubject(
  result: ArtifactResult<KernelInputDistribution>,
  capability: ReadySubjectArtifact,
): DistributionSubject {
  switch (result.status) {
    case 'pending':
      return { subject: 'kernelInputDistribution', status: 'pending' };
    case 'ready':
      if (result.schemaVersion !== capability.schemaVersion) {
        return {
          subject: 'kernelInputDistribution',
          status: 'incompatible',
          receivedSchemaVersion: result.schemaVersion,
          reason: `Descriptor expects schema v${capability.schemaVersion}, received v${result.schemaVersion}.`,
        };
      }
      return {
        subject: 'kernelInputDistribution',
        status: 'ready',
        schemaVersion: result.schemaVersion,
        payload: result.value,
      };
    case 'unavailable':
      return { subject: 'kernelInputDistribution', ...result };
    case 'not_generated':
      return { subject: 'kernelInputDistribution', ...result };
    case 'failed':
      return { subject: 'kernelInputDistribution', ...result };
    case 'incompatible':
      return {
        subject: 'kernelInputDistribution',
        status: 'incompatible',
        reason: result.reason,
        receivedSchemaVersion: result.received,
      };
  }
}

function distributionCapabilitySubject(
  capability: SubjectArtifact | undefined,
): DistributionSubject {
  if (capability === undefined || capability.status === 'ready') {
    return {
      subject: 'kernelInputDistribution',
      status: 'not_generated',
      reason:
        capability === undefined
          ? 'Run descriptor does not declare this analyzer subject.'
          : 'Kernel input distribution was not generated.',
    };
  }
  return { subject: 'kernelInputDistribution', ...capability };
}

function kernelAnalysisState(
  result: ArtifactResult<KernelThroughputAnalysis>,
): KernelAnalysisState {
  switch (result.status) {
    case 'pending':
      return { supported: true, isError: false, evidenceStatus: 'loading' };
    case 'ready':
      return { supported: true, isError: false, data: result.value };
    case 'failed':
      return {
        supported: true,
        isError: true,
        error: new Error(result.reason),
        evidenceStatus: 'failed',
      };
    case 'unavailable':
      return {
        supported: false,
        isError: false,
        evidenceStatus: 'unavailable',
        reason: result.reason,
      };
    case 'not_generated':
      return {
        supported: true,
        isError: false,
        evidenceStatus: 'not_generated',
        reason: result.reason ?? 'Kernel throughput analysis was not generated.',
      };
    case 'incompatible':
      return {
        supported: true,
        isError: false,
        evidenceStatus: 'incompatible',
        reason: result.reason,
      };
  }
}

function reasonOf(result: Exclude<ArtifactResult<unknown>, { status: 'pending' | 'ready' }>) {
  return result.reason ?? 'Exact worker CostTree was not generated.';
}

function statusTitle(status: Exclude<ArtifactResult<unknown>['status'], 'pending' | 'ready'>) {
  if (status === 'failed') return 'Could not load exact worker CostTree detail';
  const title = {
    unavailable: 'Exact worker CostTree unavailable',
    not_generated: 'Exact worker CostTree not generated',
    incompatible: 'Exact worker CostTree is incompatible',
  } as const;
  return title[status];
}

function StatusFrame({
  identity,
  title,
  detail,
  status = 'loading',
  alert = false,
  code,
  retry,
}: {
  readonly identity: CostTreeIdentity | undefined;
  readonly title: string;
  readonly detail: string;
  readonly status?: string;
  readonly alert?: boolean;
  readonly code?: string;
  readonly retry?: () => void;
}) {
  return (
    <CostTreeFrame identity={identity}>
      <CostTreeStatusViewport role={alert ? 'alert' : 'status'} busy={status === 'loading'}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          {title}
        </Typography>
        <Typography
          sx={{
            mt: 0.5,
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.sub,
            lineHeight: 1.6,
          }}
        >
          {detail}
        </Typography>
        {status !== 'loading' && (
          <Typography sx={{ mt: 1, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
            evidence status · {status}
            {code ? ` · ${code}` : ''}
          </Typography>
        )}
        {retry && (
          <Button size="small" onClick={retry} sx={{ mt: 1.5 }}>
            Retry worker detail
          </Button>
        )}
      </CostTreeStatusViewport>
    </CostTreeFrame>
  );
}

function InspectorPlaceholder({ selectedLeaf }: { readonly selectedLeaf: number | null }) {
  const wideWorkbench = useMediaQuery('(min-width:1200px)', { noSsr: true });
  if (selectedLeaf !== null || !wideWorkbench) return null;
  return (
    <Paper
      data-testid="kernel-inspector-placeholder"
      sx={{
        display: 'flex',
        height: WORKER_WORKBENCH_HEIGHT,
        boxSizing: 'border-box',
        alignItems: 'flex-start',
        p: '14px 15px',
        borderRadius: 2,
        background: tokens.tile2,
      }}
    >
      <Box>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          Kernel inspector
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
          Select a kernel in the CostTree to inspect exact execution facts.
        </Typography>
      </Box>
    </Paper>
  );
}

function ReadyTree({
  detail,
  identity,
  location,
  navigate,
}: {
  readonly detail: WorkerCostTreeDetail;
  readonly identity: CostTreeIdentity | undefined;
  readonly location: RunLocation;
  readonly navigate: Navigate;
}) {
  const tree = useMemo(() => annotate(detail.tree), [detail.tree]);
  const leaf = segmentOf(location.focus.path, 'leaf');
  const parallel = segmentOf(location.focus.path, 'parallel');
  const selectedNode = leafById(tree, leaf?.id ?? null);
  const selectedLeaf = selectedNode === null ? null : selectedNode.id;
  const selectedScope = nodeByOrdinalPath(tree, location.focus.options['cost-tree-scope'] ?? null);
  const selectedScopeId =
    selectedScope !== null && selectedScope.kind !== 'leaf' ? selectedScope.id : null;
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledTreeRef = useRef<string | null>(null);
  const lastScrolledKernelRef = useRef<string | null>(null);
  const selectedOperation = segmentOf(location.focus.path, 'operation');
  const operationMatches =
    selectedOperation !== null &&
    detail.operation.iterId === selectedOperation.iter &&
    detail.operation.batchId === selectedOperation.batch &&
    detail.operation.operationId === selectedOperation.op;
  const treeIdentity = `${detail.worker.poolTag}/${detail.worker.workerId}/${detail.operation.iterId}/${detail.operation.batchId}/${detail.operation.operationId}`;

  useEffect(() => {
    if (!operationMatches) {
      lastScrolledTreeRef.current = null;
      return;
    }
    if (lastScrolledTreeRef.current === treeIdentity) return;
    const shell = workerViewportOf(workbenchRef.current);
    if (shell === null) return;
    shell.scrollIntoView({
      behavior: pageScrollBehavior(),
      block: shellScrollBlock(shell),
      inline: 'nearest',
    });
    lastScrolledTreeRef.current = treeIdentity;
  }, [operationMatches, treeIdentity]);

  useEffect(() => {
    if (!operationMatches || selectedNode === null) {
      lastScrolledKernelRef.current = null;
      return;
    }
    const selectedIdentity = `${treeIdentity}/${selectedNode.id}`;
    if (lastScrolledKernelRef.current === selectedIdentity) return;
    const shell = workerViewportOf(workbenchRef.current);
    if (shell === null) return;
    if (!shellIsFullyVisible(shell)) {
      shell.scrollIntoView({
        behavior: pageScrollBehavior(),
        block: shellScrollBlock(shell),
        inline: 'nearest',
      });
    }
    lastScrolledKernelRef.current = selectedIdentity;
  }, [operationMatches, selectedNode, treeIdentity]);
  const selectNode = (at: 'leaf' | 'parallel', id: number) => {
    navigate({ ...location, focus: selectSegment(location.focus, { at, id }) }, 'push');
  };
  const returnToWorker = () => {
    navigate({ ...location, focus: withPanel(upTo(location.focus, 'worker'), null) }, 'push');
  };

  return (
    <Box
      ref={workbenchRef}
      data-testid="worker-exact-workbench"
      sx={{
        minWidth: 0,
        height: { xs: 'auto', lg: '100%' },
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0,1fr)',
          lg: 'minmax(0,1fr) clamp(300px,26vw,340px)',
        },
        alignItems: 'stretch',
        gap: 2,
      }}
    >
      <CostTreeEvidence
        tree={tree}
        identity={identity}
        timeBasis={`iter ${detail.operation.iterId} · batch ${detail.operation.batchId} · operation ${detail.operation.operationId}`}
        selectedLeafId={selectedLeaf}
        selectedParallelId={parallel?.id ?? null}
        selectedScopeId={selectedScopeId}
        onSelectScope={(scopeId) => {
          const scopePath = scopeId === selectedScopeId ? null : nodeOrdinalPath(tree, scopeId);
          navigate(
            { ...location, focus: withOption(location.focus, 'cost-tree-scope', scopePath) },
            'push',
          );
        }}
        onSelectLeaf={(id) => selectNode('leaf', id)}
        onSelectParallel={(id) => selectNode('parallel', id)}
        onSelectRoot={returnToWorker}
        ariaLabel="Worker CostTree canvas"
      />
      <InspectorPlaceholder selectedLeaf={selectedLeaf} />
      {selectedNode !== null && (
        <KernelInspectorView
          node={selectedNode}
          height={WORKER_WORKBENCH_HEIGHT}
          closeLabel={`Back to worker ${detail.worker.poolTag}/${detail.worker.workerId}`}
          onClose={returnToWorker}
        />
      )}
    </Box>
  );
}

function ExactTreeRead({
  location,
  navigate,
  identity,
  analysisRevision,
}: {
  readonly location: RunLocation;
  readonly navigate: Navigate;
  readonly identity: CostTreeIdentity | undefined;
  readonly analysisRevision: string;
}) {
  const ref = useMemo(
    () => workerCostTreeRef({ ...location.ref, revision: analysisRevision }, location.focus.path),
    [analysisRevision, location.focus.path, location.ref],
  );
  const { result, retry } = useArtifactWithRetry(ref);
  if (result.status === 'pending') {
    return (
      <StatusFrame
        identity={identity}
        title="Loading exact worker CostTree detail"
        detail={`Loading evidence for ${ref.worker.poolTag}/${ref.worker.workerId}…`}
      />
    );
  }
  if (result.status !== 'ready') {
    return (
      <StatusFrame
        identity={identity}
        title={statusTitle(result.status)}
        detail={reasonOf(result)}
        status={result.status}
        alert={result.status === 'failed'}
        code={result.status === 'failed' ? result.code : undefined}
        retry={result.status === 'failed' ? retry : undefined}
      />
    );
  }
  return (
    <ReadyTree detail={result.value} identity={identity} location={location} navigate={navigate} />
  );
}

export function CostTreeWorkbench({
  location,
  navigate,
  descriptor,
}: {
  readonly location: RunLocation;
  readonly navigate: Navigate;
  readonly descriptor: DescriptorResult;
}) {
  const topology = useArtifact(useMemo(() => topologyRef(location.ref), [location.ref]));
  const pool = segmentOf(location.focus.path, 'pool');
  const worker = segmentOf(location.focus.path, 'worker');
  const operation = segmentOf(location.focus.path, 'operation');
  const group =
    topology.status === 'ready' && pool !== null
      ? topology.value.pools.find((candidate) => candidate.tag === pool.role)?.group
      : undefined;
  const instance = group?.workers.find((candidate) => candidate.id === worker?.id);
  const identity =
    group === undefined || instance === undefined
      ? undefined
      : { archId: instance.id, archType: group.archType, gpuCount: instance.gpus.length };
  const capability =
    descriptor.status === 'ready' ? descriptor.value.details['worker-cost-tree'] : undefined;
  const analysisRevision =
    descriptor.status === 'ready' ? descriptor.value.analysis?.revision : undefined;

  let content;
  if (descriptor.status === 'pending' || capability?.status === 'pending') {
    content = (
      <StatusFrame
        identity={identity}
        title="Loading exact worker CostTree detail"
        detail={`Loading evidence for ${pool?.role ?? 'selected'}/${worker?.id ?? 'worker'}…`}
      />
    );
  } else if (descriptor.status !== 'ready') {
    content = (
      <StatusFrame
        identity={identity}
        title={statusTitle(descriptor.status)}
        detail={reasonOf(descriptor)}
        status={descriptor.status}
        alert={descriptor.status === 'failed'}
      />
    );
  } else if (capability?.status !== 'ready') {
    const status = capability?.status ?? 'not_generated';
    content = (
      <StatusFrame
        identity={identity}
        title={statusTitle(status)}
        detail={
          capability && 'reason' in capability && capability.reason
            ? capability.reason
            : 'Run descriptor does not provide ready worker-cost-tree.'
        }
        status={status}
        alert={status === 'failed'}
      />
    );
  } else if (operation === null) {
    content = (
      <StatusFrame
        identity={identity}
        title="Select an exact operation"
        detail="CostTree detail is requested only after an exact iter, batch/slot, and operation are selected."
        status="awaiting-selection"
      />
    );
  } else if (analysisRevision === undefined) {
    content = (
      <StatusFrame
        identity={identity}
        title="Exact worker CostTree is incompatible"
        detail="Ready worker CostTree detail requires the descriptor analysis revision."
        status="incompatible"
      />
    );
  } else {
    content = (
      <ExactTreeRead
        location={location}
        navigate={navigate}
        identity={identity}
        analysisRevision={analysisRevision}
      />
    );
  }

  return (
    <Box
      data-testid="worker-workbench-row"
      sx={{ minWidth: 0, minHeight: 0, height: { xs: 'auto', lg: '100%' } }}
    >
      {content}
    </Box>
  );
}

export function WorkerViewport({ children }: { readonly children: ReactNode }) {
  return (
    <Box
      data-testid="worker-viewport-shell"
      sx={{
        [WORKER_VIEWPORT_HEIGHT_VAR]: `calc(100dvh - ${WORKER_VIEWPORT_SAFE_GAP}px)`,
        [WORKER_WORKBENCH_MIN_HEIGHT_VAR]: `${WORKER_WORKBENCH_MIN_HEIGHT}px`,
        [WORKER_WORKBENCH_MAX_HEIGHT_VAR]: `${COST_TREE_FRAME_HEIGHT}px`,
        [WORKER_WORKBENCH_HEIGHT_VAR]: {
          xs: `${COST_TREE_FRAME_HEIGHT}px`,
          lg: '100%',
        },
        minWidth: 0,
        display: 'grid',
        gridTemplateRows: {
          xs: 'auto auto',
          lg: `max-content minmax(var(${WORKER_WORKBENCH_MIN_HEIGHT_VAR}), var(${WORKER_WORKBENCH_MAX_HEIGHT_VAR}))`,
        },
        gap: 2,
        height: { xs: 'auto', lg: `var(${WORKER_VIEWPORT_HEIGHT_VAR})` },
        alignContent: { lg: 'center' },
      }}
    >
      {children}
    </Box>
  );
}

function ReadyDistributionEvidence({
  location,
  analysisRevision,
  node,
  analysis,
  capability,
}: {
  readonly location: RunLocation;
  readonly analysisRevision: string;
  readonly node: LeafNode;
  readonly analysis: KernelAnalysisState;
  readonly capability: ReadySubjectArtifact;
}) {
  const ref = useMemo(
    () => kernelInputDistributionRef({ ...location.ref, revision: analysisRevision }),
    [analysisRevision, location.ref],
  );
  const distribution = useArtifact(ref);
  return (
    <KernelEvidenceView
      node={node}
      analysis={analysis}
      distributionSubject={distributionSubject(distribution, capability)}
    />
  );
}

function ExactKernelEvidence({
  location,
  analysisRevision,
  node,
  distributionCapability,
}: {
  readonly location: RunLocation;
  readonly analysisRevision: string;
  readonly node: LeafNode;
  readonly distributionCapability: SubjectArtifact | undefined;
}) {
  const ref = useMemo(
    () =>
      kernelThroughputAnalysisRef(
        { ...location.ref, revision: analysisRevision },
        location.focus.path,
      ),
    [analysisRevision, location.focus.path, location.ref],
  );
  const analysisResult = useArtifact(ref);
  const analysis = kernelAnalysisState(analysisResult);
  if (distributionCapability?.status === 'ready') {
    return (
      <ReadyDistributionEvidence
        location={location}
        analysisRevision={analysisRevision}
        node={node}
        analysis={analysis}
        capability={distributionCapability}
      />
    );
  }
  return (
    <KernelEvidenceView
      node={node}
      analysis={analysis}
      distributionSubject={distributionCapabilitySubject(distributionCapability)}
    />
  );
}

function ExactTreeSupplementary({
  location,
  navigate,
  analysisRevision,
  distributionCapability,
  scopedOptimalityAvailable,
}: {
  readonly location: RunLocation;
  readonly navigate: Navigate;
  readonly analysisRevision: string;
  readonly distributionCapability: SubjectArtifact | undefined;
  readonly scopedOptimalityAvailable: boolean;
}) {
  const ref = useMemo(
    () => workerCostTreeRef({ ...location.ref, revision: analysisRevision }, location.focus.path),
    [analysisRevision, location.focus.path, location.ref],
  );
  const result = useArtifact(ref);
  const tree = useMemo(
    () => (result.status === 'ready' ? annotate(result.value.tree) : null),
    [result],
  );
  if (result.status !== 'ready' || tree === null) return null;
  const leaf = segmentOf(location.focus.path, 'leaf');
  const parallel = segmentOf(location.focus.path, 'parallel');
  const selectedLeaf = leafById(tree, leaf?.id ?? null);
  const selectedParallel = nodeById(tree, parallel?.id ?? null);
  const selectedScope = nodeByOrdinalPath(tree, location.focus.options['cost-tree-scope'] ?? null);
  const selectedScopeId =
    selectedScope !== null && selectedScope.kind !== 'leaf' ? selectedScope.id : null;
  const returnToWorker = () => {
    navigate({ ...location, focus: withPanel(upTo(location.focus, 'worker'), null) }, 'push');
  };
  const selectKernel = (id: number) => {
    navigate({ ...location, focus: selectSegment(location.focus, { at: 'leaf', id }) }, 'push');
  };

  return (
    <Box data-testid="worker-supplementary" sx={{ display: 'grid', gap: 2 }}>
      {selectedLeaf !== null && (
        <ExactKernelEvidence
          location={location}
          analysisRevision={analysisRevision}
          node={selectedLeaf}
          distributionCapability={distributionCapability}
        />
      )}
      {selectedParallel?.kind === 'max' && (
        <ParallelDetailView
          node={selectedParallel}
          closeLabel={`Back to worker ${result.value.worker.poolTag}/${result.value.worker.workerId}`}
          onClose={returnToWorker}
        />
      )}
      <ScopedOptimalityCard
        result={location.ref}
        tree={tree}
        section={result.value.section}
        selectedScopeId={selectedScopeId ?? selectedLeaf?.id ?? selectedParallel?.id ?? null}
        available={scopedOptimalityAvailable}
        evidence={{
          evidenceId: 'scoped-optimality',
          selectedForAgent: location.focus.options['evidence-panel'] === 'scoped-optimality',
          onEvidenceSelect: () =>
            navigate(
              {
                ...location,
                focus: withOption(location.focus, 'evidence-panel', 'scoped-optimality'),
              },
              'replace',
            ),
        }}
      />
      <TimeShareBlocksView
        tree={tree}
        selectedLeafId={selectedLeaf?.id ?? null}
        onSelectKernel={selectKernel}
      />
    </Box>
  );
}

export function CostTreeSupplementary({
  location,
  navigate,
  descriptor,
}: {
  readonly location: RunLocation;
  readonly navigate: Navigate;
  readonly descriptor: DescriptorResult;
}) {
  const operation = segmentOf(location.focus.path, 'operation');
  const capability =
    descriptor.status === 'ready' ? descriptor.value.details['worker-cost-tree'] : undefined;
  const analysisRevision =
    descriptor.status === 'ready' ? descriptor.value.analysis?.revision : undefined;
  const distributionCapability =
    descriptor.status === 'ready' ? descriptor.value.subjects.kernelInputDistribution : undefined;
  const scopedOptimalityAvailable =
    descriptor.status === 'ready' && descriptor.value.subjects.scopedOptimality?.status === 'ready';
  if (operation === null || capability?.status !== 'ready' || analysisRevision === undefined) {
    return null;
  }
  return (
    <ExactTreeSupplementary
      location={location}
      navigate={navigate}
      analysisRevision={analysisRevision}
      distributionCapability={distributionCapability}
      scopedOptimalityAvailable={scopedOptimalityAvailable}
    />
  );
}
