/**
 * Route assembly: read the `Location`, render what it names.
 *
 * This file assembles and nothing else — no analysis, no fetching, and no
 * knowledge of any particular panel. A result address is resolved against the
 * registry and the layout (`resolve.ts`), and each panel arrives as its own
 * chunk. Adding a panel therefore does not change this file.
 */
import { Alert, Container, Stack, Typography } from '@mui/material';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  useLocation,
  type Navigate,
  type Location,
} from '../location';
import EntryPage from './EntryPage';
import type { RenderAgentMarkdown } from '../panels/conversation/ConversationTranscript';
import MarkdownBody from '../panels/shared/MarkdownBody';
import CatalogTag from '../ui/CatalogTag';
import { commit } from './commit';
import AgentHost from './AgentHost';
import { agentContext } from './agentContext';
import { chatAt, startNewConversation } from './agentLocation';
import { managedResultLocation, resolveEvidence } from './evidence';
import { ResultMain } from './ResultPage';
import { RESULT_TITLE, displayResultName } from './resultTitle';
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

function View({ location }: { location: Location }) {
  switch (location.view) {
    case 'catalog':
      return null;
    case 'result':
      return <ResultMain location={location} />;
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
