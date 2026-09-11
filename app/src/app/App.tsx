/**
 * Route assembly: read the `Location`, render what it names.
 *
 * This file assembles and nothing else — no analysis, no fetching, and no
 * knowledge of any particular panel. A result address is resolved against the
 * registry and the layout (`resolve.ts`), and each panel arrives as its own
 * chunk. Adding a panel therefore does not change this file.
 */
import { Alert, Box, Container, Skeleton, Stack, Typography } from '@mui/material';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react';

import {
  catalogRef,
  sweepAnalysisRef,
  useArtifacts,
  type CatalogEntry,
  type SweepAnalysisRef,
} from '../artifacts';
import {
  formatLocation,
  workspaceOf,
  upTo,
  useLocation,
  withPanel,
  type Navigate,
  type Location,
} from '../location';
import EntryPage from './EntryPage';
import type { RenderAgentMarkdown } from '../panels/conversation/ConversationTranscript';
import type { ContentPanelSpec, PanelProps } from '../panels/types';
import { PanelEvidenceProvider } from '../panels/PanelEvidenceProvider';
import MarkdownBody from '../panels/shared/MarkdownBody';
import AnalysisSection from '../ui/controls/AnalysisSection';
import { SectionFrameSubtitleContext } from '../ui/controls/SectionFrameSubtitleContext';
import { SectionPanelToggle } from '../ui/controls/SectionPanelToggle';
import { tokens } from '../ui/theme';
import CatalogTag from '../ui/CatalogTag';
import { pageLayout } from '../ui/theme/metrics';
import { commit } from './commit';
import AgentHost from './AgentHost';
import { agentContext } from './agentContext';
import { chatAt, startNewConversation } from './agentLocation';
import { managedResultLocation, resolveEvidence } from './evidence';
import { resolveResult, type ResolvedSection } from './resolve';
import Shell, { type AgentSurfaceControls } from './Shell';

const FilePage = lazy(() => import('./FilePage'));

export function App() {
  const location = useLocation();
  return <LocatedApp location={location} />;
}

/** Render one already-parsed address so root-level UI state can key off the same value. */
export function LocatedApp({ location }: { location: Location | null }) {
  if (location === null) return <Unaddressable />;
  if (location.view === 'catalog') {
    return <EntryPage filter={location.filter} navigate={commit} />;
  }
  return <AddressedApp location={location} navigate={commit} />;
}

function AddressedApp({ location, navigate }: { location: Location; navigate: Navigate }) {
  const workspace = workspaceOf(location);
  const chat = chatAt(location);
  const catalogReads = useArtifacts(
    location.view === 'result' ? [catalogRef(location.ref.workspace, location.ref.kind)] : [],
  );
  const sweepRefs: SweepAnalysisRef[] =
    location.view === 'result' && location.ref.kind === 'sweep'
      ? [sweepAnalysisRef({ ...location.ref, kind: 'sweep' })]
      : [];
  const sweepReads = useArtifacts(sweepRefs);
  const sweepAnalysis = sweepReads[0]?.status === 'ready' ? sweepReads[0].value : undefined;
  const context = useMemo(() => agentContext(location, sweepAnalysis), [location, sweepAnalysis]);
  const [clearedContext, setClearedContext] = useState<string | null>(null);
  const activeContext = context?.identity === clearedContext ? null : context;
  const evidenceRequest = useRef<{ generation: number; controller: AbortController } | null>(null);
  const locationIdentity = formatLocation(location);
  useEffect(
    () => () => {
      evidenceRequest.current?.controller.abort();
      evidenceRequest.current = null;
    },
    [locationIdentity],
  );
  const renderMarkdown = useCallback<RenderAgentMarkdown>(
    (text, citations, workspaceId, compact) => (
      <MarkdownBody
        text={text}
        citations={citations}
        workspaceId={workspaceId}
        compact={compact}
        onOpenFile={(nextWorkspace, path, line) =>
          navigate({ view: 'file', file: { workspace: nextWorkspace, path, line } }, 'push')
        }
        onOpenEvidence={(target, onStatus) => {
          evidenceRequest.current?.controller.abort();
          const generation = (evidenceRequest.current?.generation ?? 0) + 1;
          const controller = new AbortController();
          evidenceRequest.current = { generation, controller };
          onStatus('opening');
          void resolveEvidence(target, chat, controller.signal)
            .then((result) => {
              if (controller.signal.aborted || evidenceRequest.current?.generation !== generation) {
                return;
              }
              onStatus(result.status);
              if (result.status === 'ok') navigate(result.location, 'push');
            })
            .catch(() => {
              if (
                !controller.signal.aborted &&
                evidenceRequest.current?.generation === generation
              ) {
                onStatus('unavailable');
              }
            });
        }}
      />
    ),
    [chat, navigate],
  );
  const openAgent = () => navigate(startNewConversation(location, workspace), 'push');
  const catalog = {
    view: 'catalog' as const,
    filter: { workspace, kinds: [], query: null },
  };
  const catalogEntry =
    location.view === 'result' && catalogReads[0]?.status === 'ready'
      ? catalogReads[0].value.find(
          (entry) =>
            entry.kind === location.ref.kind &&
            entry.workspace === location.ref.workspace &&
            entry.id === location.ref.id,
        )
      : undefined;
  const title = shellTitle(location, catalogEntry);
  return (
    <Shell
      title={title.title}
      detail={title.detail}
      metadata={title.metadata}
      agentOpen={chat !== null}
      fullAgent={location.view === 'chat'}
      onBack={() => navigate(catalog, 'push')}
      onOpenAgent={openAgent}
      agent={
        chat === null
          ? null
          : (controls: AgentSurfaceControls) => (
              <AgentHost
                location={location}
                navigate={navigate}
                selectionContext={activeContext?.display ?? null}
                analyzerContext={activeContext?.turn ?? null}
                onClearSelectionContext={() => setClearedContext(context?.identity ?? null)}
                renderMarkdown={renderMarkdown}
                onOpenManagedResult={(card) => {
                  const result = managedResultLocation(card, chat);
                  if (result !== null) navigate(result, 'push');
                }}
                full={controls.expanded}
                expanded={controls.expanded}
                visible={controls.visible}
                onFold={controls.onFold}
                onToggleFull={controls.onToggleFull}
              />
            )
      }
    >
      <View location={location} />
    </Shell>
  );
}

function displayResultName(value: string): string {
  return value.replace(/^\d{8}_\d+_/, '');
}

function sweepMetadata(entry: CatalogEntry): ReactNode {
  const deployments = entry.deployments ?? [];
  const traces = entry.traces ?? [];
  const axes = entry.axes ?? [];
  if (deployments.length === 0 && traces.length === 0 && axes.length === 0) return undefined;
  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{ mt: 0.25, minWidth: 0, gap: 0.45, overflow: 'hidden' }}
    >
      {deployments.slice(0, 1).map((deployment) => (
        <CatalogTag key={deployment} tone="deployment" compact>
          {deployment}
        </CatalogTag>
      ))}
      {traces.slice(0, 1).map((trace) => (
        <CatalogTag key={trace} tone="trace" compact>
          {trace}
        </CatalogTag>
      ))}
      {axes.slice(0, 2).map((axis) => (
        <CatalogTag key={axis} tone="axis" compact>
          {axis}
        </CatalogTag>
      ))}
    </Stack>
  );
}

function shellTitle(
  location: Location,
  entry?: CatalogEntry,
): { readonly title: string; readonly detail?: string; readonly metadata?: ReactNode } {
  switch (location.view) {
    case 'catalog':
      return { title: 'Analyzer' };
    case 'chat':
      return { title: 'Agent' };
    case 'file': {
      const name = location.file.path.split('/').filter(Boolean).at(-1) ?? location.file.path;
      return { title: name, detail: location.file.path };
    }
    case 'result':
      return {
        title:
          location.ref.kind === 'sweep'
            ? entry === undefined
              ? 'Analyzer'
              : displayResultName(entry.displayName)
            : location.ref.kind === 'run'
              ? 'Analyzer'
              : RESULT_TITLE[location.ref.kind],
        ...(location.ref.kind === 'sweep' && entry?.numRuns !== undefined
          ? { detail: `${entry.numRuns} ${entry.numRuns === 1 ? 'run' : 'runs'}` }
          : {}),
        ...(location.ref.kind === 'sweep' && entry !== undefined
          ? { metadata: sweepMetadata(entry) }
          : {}),
      };
  }
}

const RESULT_TITLE = {
  sweep: 'Sweep',
  prediction: 'Timing prediction',
  alignment: 'Alignment',
  kernelProfile: 'Kernel profile',
  kernelMeasurement: 'Kernel measurement',
  run: 'Run',
} as const;

function View({ location }: { location: Location }) {
  switch (location.view) {
    case 'catalog':
      return null;
    case 'result':
      return location.ref.kind === 'run' ? (
        <Box component="main" sx={{ ...pageLayout, mx: 'auto', px: 0, pt: 3.75, pb: 10 }}>
          <ResultView location={location} />
        </Box>
      ) : (
        <ResultView location={location} />
      );
    case 'chat':
      return null;
    case 'file':
      return (
        <Suspense fallback={null}>
          <FilePage file={location.file} navigate={commit} />
        </Suspense>
      );
  }
}

function ResultView({ location }: { location: Extract<Location, { view: 'result' }> }) {
  return <ResultBody location={location} />;
}

function ResultBody({ location }: { location: Extract<Location, { view: 'result' }> }) {
  const resolution = useMemo(() => resolveResult(location), [location]);
  switch (resolution.status) {
    case 'unaddressable':
      return (
        <Box>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {resolution.reason}
          </Alert>
          <Address location={location} />
        </Box>
      );
    case 'panel':
      return <LoadedPanel spec={resolution.panel} location={location} />;
    case 'page':
      return <Page sections={resolution.sections} location={location} />;
  }
}

/**
 * The sections of a result page, in layout order.
 *
 * An empty page is reported rather than rendered as blankness: while the port
 * is in progress a kind can legitimately have a layout and no panels yet, and
 * the difference between "nothing here yet" and "something failed" is the whole
 * value of saying it.
 */
function Page({
  sections,
  location,
}: {
  sections: readonly ResolvedSection[];
  location: Extract<Location, { view: 'result' }>;
}) {
  if (sections.length === 0) {
    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          No panel in this build applies at this address yet.
        </Alert>
        <Address location={location} />
      </Box>
    );
  }
  return (
    <Stack spacing={0}>
      {sections.map((section) => {
        const rows = (
          <Stack spacing={section.spacing ?? 2}>
            {section.rows.map((row) => (
              <Box
                key={row.map((spec) => spec.id).join('|')}
                sx={{
                  display: 'grid',
                  gridTemplateColumns:
                    row.length > 1 ? { xs: '1fr', md: `repeat(${row.length},1fr)` } : '1fr',
                  gap: 2,
                }}
              >
                {row.map((spec) => (
                  <LoadedPanel key={spec.id} spec={spec} location={location} />
                ))}
              </Box>
            ))}
          </Stack>
        );
        if (section.frame !== null) {
          const control = section.frame.control;
          return (
            <FramedAnalysisSection
              key={section.title}
              idx={section.frame.idx}
              title={section.frame.title}
              sub={section.frame.sub}
              accent={
                section.frame.accent === 'analysis'
                  ? tokens.sectionAnalysis
                  : section.frame.accent === 'structure'
                    ? tokens.sectionStructure
                    : tokens.gold
              }
              controls={
                control === null ? undefined : (
                  <SectionPanelToggle
                    ariaLabel={control.ariaLabel}
                    value={control.value}
                    options={control.options}
                    onChange={(value) => {
                      const option = control.options.find((candidate) => candidate.value === value);
                      if (option === undefined) return;
                      const focus = withPanel(upTo(location.focus, option.upTo), option.panel);
                      commit({ ...location, focus }, 'push');
                    }}
                  />
                )
              }
            >
              {rows}
            </FramedAnalysisSection>
          );
        }
        return (
          <Stack key={section.title} spacing={2}>
            {section.heading !== false && (
              <Typography variant="overline" color="text.secondary">
                {section.title}
              </Typography>
            )}
            {rows}
          </Stack>
        );
      })}
    </Stack>
  );
}

function FramedAnalysisSection({ sub, ...props }: ComponentProps<typeof AnalysisSection>) {
  const [reportedSub, setReportedSub] = useState<string | undefined>();
  return (
    <SectionFrameSubtitleContext.Provider value={setReportedSub}>
      <AnalysisSection {...props} sub={reportedSub ?? sub} />
    </SectionFrameSubtitleContext.Provider>
  );
}

/**
 * One panel, fetched when it is first rendered.
 *
 * `lazy` is memoised per spec because React treats a new lazy component as a
 * different component: rebuilding it on every render would unmount and remount
 * the panel, discarding its state and re-running its reads on every keystroke
 * elsewhere on the page.
 */
function LoadedPanel({
  spec,
  location,
}: {
  spec: ContentPanelSpec;
  location: Extract<Location, { view: 'result' }>;
}) {
  const Panel = componentFor(spec);
  return (
    <Suspense fallback={<Skeleton variant="rounded" height={220} />}>
      <PanelEvidenceProvider location={location} navigate={commit}>
        <Panel location={location} navigate={commit} />
      </PanelEvidenceProvider>
    </Suspense>
  );
}

const LOADED = new Map<string, ComponentType<PanelProps>>();

function componentFor(spec: ContentPanelSpec): ComponentType<PanelProps> {
  const existing = LOADED.get(spec.id);
  if (existing !== undefined) return existing;
  const created = lazy(async () => ({ default: await spec.load() }));
  LOADED.set(spec.id, created);
  return created;
}

/**
 * A hash this build cannot represent. Reported rather than redirected: landing
 * the user on the catalog would hide that the link was wrong, which is exactly
 * what makes a stale evidence citation hard to diagnose.
 */
function Unaddressable() {
  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Alert severity="warning">
        <Typography variant="body2">
          This address does not name anything: {window.location.hash || '(empty)'}
        </Typography>
      </Alert>
    </Container>
  );
}

function Address({ location }: { location: Location }) {
  return (
    <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap' }}>
      {formatLocation(location)}
    </Typography>
  );
}
