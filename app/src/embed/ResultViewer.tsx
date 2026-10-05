/**
 * One result's pages, embedded in another page.
 *
 * The page that embeds it (the Intro site's "Read more") owns the result and
 * answers the Analyzer's URLs itself: `transport` answers every read. What
 * renders is the application's own result page (`app/ResultPage.tsx`) for
 * the same `Location`, without the shell, the catalog or the Agent, which
 * need the application's servers.
 *
 * It fills its element's height, and renders into whatever root its element
 * is attached to. In a shadow root,
 * as the Intro site mounts it, the page's styles stay out and the viewer's
 * stay in: emotion writes its styles there, portals open inside the viewer,
 * and the global CssBaseline rules apply to the viewer's root only. Two
 * things remain the page's:
 *
 * - the Geist faces, since a shadow root does not load `@font-face` (the Intro
 *   site declares them);
 * - the root font size, which every rem in the theme is relative to: while
 *   mounted, the viewer sets the application's reading scale on the page's
 *   root element and restores it after.
 *
 * The address is the page's hash, as in the application, so drill-downs and
 * the Back button work as there; Back past the first address closes the
 * viewer, and closing it clears the hash. The pages offer no way to the
 * catalog, which the viewer does not show.
 */
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import CloseRounded from '@mui/icons-material/CloseRounded';
import {
  Alert,
  Box,
  Button,
  IconButton,
  ScopedCssBaseline,
  Stack,
  Typography,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { catalogRef, setFallbackTransport, useArtifacts, type Transport } from '../artifacts';
import {
  defaultWorkspace,
  EMPTY_FOCUS,
  useLocation,
  type Location,
  type WorkspaceId,
} from '../location';
import { chartFocusResetKey } from '../app/chartFocusKey';
import { commit } from '../app/commit';
import { createQueryClient } from '../app/queryClient';
import { ResultMain } from '../app/ResultPage';
import { RESULT_TITLE, displayResultName } from '../app/resultTitle';
import { CatalogReachableProvider } from '../panels/CatalogReachable';
import { ChartFocusProvider } from '../ui/controls/ChartFocusProvider';
import FocusDialog from '../ui/controls/FocusDialog';
import { metrics } from '../ui/theme';
import { embedTheme } from './embedTheme';

export interface ResultViewerProps {
  readonly kind: 'run' | 'prediction';
  /** The Analyzer catalog's id of the result. */
  readonly id: string;
  /**
   * The workspace the Analyzer names the result in, which a run's descriptor
   * is checked against. Without one, the result is in the workspace of an
   * address that names none (`defaultWorkspace`).
   */
  readonly workspace?: WorkspaceId;
  /**
   * The result's name, when the embedding page has one: the header and a
   * run's headline show it and read no catalog, which a page serving one
   * result need not answer.
   */
  readonly displayName?: string;
  /** Answers every Analyzer URL the pages read. */
  readonly transport: Transport;
  readonly onClose: () => void;
}

export function ResultViewer(props: ResultViewerProps) {
  // The element the viewer is attached at: its root gets the styles, and
  // portals open in it.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const styled = useMemo(
    () =>
      host === null
        ? null
        : {
            cache: createCache({ key: 'ssui', container: styleRoot(host) }),
            theme: embedTheme(host),
          },
    [host],
  );
  return (
    <div ref={setHost} style={{ height: '100%' }}>
      {styled !== null && (
        <CacheProvider value={styled.cache}>
          <ThemeProvider theme={styled.theme}>
            <ScopedCssBaseline sx={{ minHeight: '100%' }}>
              <Viewer {...props} />
            </ScopedCssBaseline>
          </ThemeProvider>
        </CacheProvider>
      )}
    </div>
  );
}

/** Where emotion writes the viewer's styles: its shadow root, else the document's head. */
function styleRoot(element: HTMLElement): Node {
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root : document.head;
}

function Viewer({
  kind,
  id,
  workspace = defaultWorkspace(),
  displayName,
  transport,
  onClose,
}: ResultViewerProps) {
  const [queryClient] = useState(createQueryClient);
  const [ready, setReady] = useState(false);
  const catalogAccess = useMemo(() => ({ reachable: false, name: displayName }), [displayName]);
  useEffect(() => {
    // Before any panel reads: effects run child first, so the reads must not
    // mount until the transport is in place.
    const release = setFallbackTransport(transport);
    const root = document.documentElement;
    const fontSize = root.style.fontSize;
    root.style.fontSize = `${metrics.fontScale * 100}%`;
    commit(resultAt(kind, id, workspace), 'push');
    setReady(true);
    return () => {
      release();
      root.style.fontSize = fontSize;
      if (window.location.hash !== '') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
  }, [kind, id, workspace, transport]);
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogReachableProvider value={catalogAccess}>
        <Addressed
          kind={kind}
          id={id}
          workspace={workspace}
          displayName={displayName}
          onClose={onClose}
        />
      </CatalogReachableProvider>
    </QueryClientProvider>
  );
}

function resultAt(kind: ResultViewerProps['kind'], id: string, workspace: WorkspaceId): Location {
  return { view: 'result', ref: { kind, id, workspace }, focus: EMPTY_FOCUS, chat: null };
}

function Addressed({
  kind,
  id,
  workspace,
  displayName,
  onClose,
}: {
  kind: ResultViewerProps['kind'];
  id: string;
  workspace: WorkspaceId;
  displayName: string | undefined;
  onClose: () => void;
}) {
  const location = useLocation();
  // Back past the viewer's first address leaves the page's own: close.
  const shown = useRef(false);
  useEffect(() => {
    if (location?.view === 'result') shown.current = true;
    else if (shown.current && window.location.hash === '') onClose();
  }, [location, onClose]);
  return (
    <ChartFocusProvider resetKey={chartFocusResetKey(location)}>
      <Header kind={kind} onClose={onClose}>
        {displayName === undefined ? (
          <CatalogName kind={kind} id={id} workspace={workspace} />
        ) : (
          <Name value={displayName} />
        )}
      </Header>
      {location?.view === 'result' ? (
        <ResultMain location={location} />
      ) : (
        <Box sx={{ maxWidth: 560, mx: 'auto', py: 6, px: 2 }}>
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={() => window.history.back()}>
                Back
              </Button>
            }
          >
            This view needs the ServingStudio application; only the pages of this result are shown
            here.
          </Alert>
        </Box>
      )}
      <FocusDialog />
    </ChartFocusProvider>
  );
}

function Header({
  kind,
  onClose,
  children,
}: {
  kind: ResultViewerProps['kind'];
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Stack
      component="header"
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{ px: { xs: 2, md: 3 }, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Typography variant="h6" component="h1" sx={{ fontWeight: 600, flexShrink: 0 }}>
        {RESULT_TITLE[kind]}
      </Typography>
      {children}
      <IconButton aria-label="Close" onClick={onClose} edge="end">
        <CloseRounded />
      </IconButton>
    </Stack>
  );
}

/** The result's name as its catalog entry gives it. */
function CatalogName({
  kind,
  id,
  workspace,
}: {
  kind: ResultViewerProps['kind'];
  id: string;
  workspace: WorkspaceId;
}) {
  const [catalog] = useArtifacts([catalogRef(workspace, kind)]);
  const entry =
    catalog?.status === 'ready'
      ? catalog.value.find((candidate) => candidate.id === id)
      : undefined;
  return (
    <Name
      value={entry === undefined ? '' : displayResultName(entry.displayName)}
      title={entry?.displayName}
    />
  );
}

function Name({ value, title = value }: { value: string; title?: string }) {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      noWrap
      sx={{ flex: 1, minWidth: 0 }}
      title={title || undefined}
    >
      {value}
    </Typography>
  );
}
