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
 * viewer, and closing it clears the hash. A run's address is in the workspace
 * its descriptor names, since the pages check the descriptor against it.
 * The pages offer no way to the catalog, which the viewer does not show, and
 * read none: the result is named as the embedding page names it, or not at
 * all.
 */
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { Alert, Box, Button, IconButton, ScopedCssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { runDescriptorRef, setFallbackTransport, type Transport } from '../artifacts';
import { parseAnalyzerV1RunDescriptor } from '../artifacts/schema/descriptor';
import { artifactUrl } from '../artifacts/url';
import {
  defaultWorkspace,
  EMPTY_FOCUS,
  useLocation,
  workspaceIdSchema,
  type Location,
  type WorkspaceId,
} from '../location';
import { chartFocusResetKey } from '../app/chartFocusKey';
import { commit } from '../app/commit';
import { createQueryClient } from '../app/queryClient';
import { ResultMain } from '../app/ResultPage';
import { ResultHostProvider } from '../panels/ResultHost';
import { ChartFocusProvider } from '../ui/controls/ChartFocusProvider';
import FocusDialog from '../ui/controls/FocusDialog';
import { metrics } from '../ui/theme';
import { embedTheme } from './embedTheme';

export interface ResultViewerProps {
  readonly kind: 'run' | 'prediction';
  /** The Analyzer catalog's id of the result. */
  readonly id: string;
  /**
   * The result's name, when the embedding page has one: the header and the
   * result's headline show it. Without one they name the result by no id.
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

function Viewer({ kind, id, displayName, transport, onClose }: ResultViewerProps) {
  const [queryClient] = useState(createQueryClient);
  const [ready, setReady] = useState(false);
  const host = useMemo(() => ({ catalogReachable: false, resultName: displayName }), [displayName]);
  useEffect(() => {
    // Before any panel reads: effects run child first, so the reads must not
    // mount until the transport is in place.
    const release = setFallbackTransport(transport);
    const root = document.documentElement;
    const fontSize = root.style.fontSize;
    root.style.fontSize = `${metrics.fontScale * 100}%`;
    const reading = new AbortController();
    void servedWorkspace(kind, id, transport, reading.signal).then((workspace) => {
      if (reading.signal.aborted) return;
      commit(resultAt(kind, id, workspace), 'push');
      setReady(true);
    });
    return () => {
      reading.abort();
      release();
      root.style.fontSize = fontSize;
      if (window.location.hash !== '') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
  }, [kind, id, transport]);
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ResultHostProvider value={host}>
        <Addressed onClose={onClose} />
      </ResultHostProvider>
    </QueryClientProvider>
  );
}

/**
 * The workspace the Analyzer names a run in, as the run's descriptor gives it:
 * the pages check the descriptor against the address's workspace, which the
 * embedding page cannot know. A prediction's reads are checked against none.
 * A descriptor that cannot be read leaves the address's default, and the
 * pages then say why their read failed.
 */
async function servedWorkspace(
  kind: ResultViewerProps['kind'],
  id: string,
  transport: Transport,
  signal: AbortSignal,
): Promise<WorkspaceId> {
  if (kind !== 'run') return defaultWorkspace();
  try {
    // The descriptor's address does not depend on the workspace asked for.
    const url = artifactUrl(runDescriptorRef({ kind, id, workspace: defaultWorkspace() }));
    const response = await transport(url, { signal });
    if (!response.ok) return defaultWorkspace();
    const named = workspaceIdSchema.safeParse(
      parseAnalyzerV1RunDescriptor(await response.json()).workspaceId,
    );
    return named.success ? named.data : defaultWorkspace();
  } catch {
    return defaultWorkspace();
  }
}

function resultAt(kind: ResultViewerProps['kind'], id: string, workspace: WorkspaceId): Location {
  return { view: 'result', ref: { kind, id, workspace }, focus: EMPTY_FOCUS, chat: null };
}

function Addressed({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  // Back past the viewer's first address leaves the page's own: close.
  const shown = useRef(false);
  useEffect(() => {
    if (location?.view === 'result') shown.current = true;
    else if (shown.current && window.location.hash === '') onClose();
  }, [location, onClose]);
  return (
    <ChartFocusProvider resetKey={chartFocusResetKey(location)}>
      <CloseControl onClose={onClose} />
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

/**
 * The viewer's only chrome: the pages head themselves (title and name), so
 * the close control floats over their top right corner and takes no row.
 */
function CloseControl({ onClose }: { onClose: () => void }) {
  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        height: 0,
        display: 'flex',
        justifyContent: 'flex-end',
        px: { xs: 1, md: 2 },
        pt: 1,
      }}
    >
      <IconButton
        aria-label="Close"
        onClick={onClose}
        sx={{
          bgcolor: 'background.paper',
          boxShadow: 1,
          '&:hover': { bgcolor: 'background.paper' },
        }}
      >
        <CloseRounded />
      </IconButton>
    </Box>
  );
}
