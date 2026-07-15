import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { tokens } from '../theme';

type TraceName = 'pd_smoke' | 'afd_smoke';
type TraceStatus = 'idle' | 'connecting' | 'loading' | 'loaded' | 'error';

const TRACE_NAMES: TraceName[] = ['pd_smoke', 'afd_smoke'];
const TRACES: Record<TraceName, { file: string; title: string }> = {
  pd_smoke: { file: 'pd_smoke.pftrace.gz', title: 'PD smoke · execution trace' },
  afd_smoke: { file: 'afd_smoke.pftrace.gz', title: 'AFD smoke · execution trace' },
};

/** Lazy embedded Perfetto viewer. Perfetto's channel is unbuffered, so every
 *  newly mounted iframe must answer PING before receiving a trace buffer. */
export default function PerfettoTrace() {
  const [expanded, setExpanded] = useState(false);
  const [traceName, setTraceName] = useState<TraceName>('pd_smoke');
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<TraceStatus>('idle');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // This iframe runs only in the browser; keep the DOM timer identity from
  // being widened to NodeJS.Timeout when Playwright types are installed.
  const intervalRef = useRef<number | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!expanded) {
      readyRef.current = false;
      setStatus('idle');
      return;
    }

    const iframe = iframeRef.current;
    const w = iframe?.contentWindow;
    if (!iframe || !w) return;

    let disposed = false;
    const trace = TRACES[traceName];

    const clearPing = () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const postTrace = async () => {
      setStatus('loading');
      try {
        const buffer = await (
          await fetch(`${import.meta.env.BASE_URL}${trace.file}`)
        ).arrayBuffer();
        if (disposed || iframeRef.current !== iframe || iframe.contentWindow !== w) return;
        w.postMessage(
          {
            perfetto: {
              buffer,
              title: trace.title,
              fileName: trace.file,
              keepApiOpen: true,
              localOnly: false,
            },
          },
          '*',
        );
        setStatus('loaded');
      } catch {
        if (!disposed) setStatus('error');
      }
    };

    const onMessage = (evt: MessageEvent<unknown>) => {
      if (evt.source === iframe.contentWindow && evt.data === 'PONG' && !readyRef.current) {
        clearPing();
        readyRef.current = true;
        void postTrace();
      }
    };

    if (readyRef.current) {
      void postTrace();
    } else {
      setStatus('connecting');
      intervalRef.current = window.setInterval(() => w.postMessage('PING', '*'), 100);
      window.addEventListener('message', onMessage);
    }

    // Once the backend serves the current run's own trace, cursorSeconds(state)
    // can post { perfetto: { timeStart, timeEnd, viewPercentage } } in seconds.
    return () => {
      disposed = true;
      clearPing();
      window.removeEventListener('message', onMessage);
    };
  }, [expanded, reloadKey, traceName]);

  const statusText =
    status === 'connecting'
      ? 'connecting to Perfetto…'
      : status === 'loading'
        ? `loading ${traceName}…`
        : status === 'loaded'
          ? `loaded ${traceName}`
          : status === 'error'
            ? `could not load ${traceName}`
            : '';

  return (
    <Paper
      sx={{
        width: '100%',
        borderRadius: 2,
        p: '15px 16px 16px',
        border: `1px solid ${tokens.hair}`,
        boxShadow: tokens.shadow,
        transition: `box-shadow .4s ${tokens.ease}, border-color .3s ${tokens.ease}`,
        '&:hover': { borderColor: tokens.sub2, boxShadow: tokens.shadowLift },
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        useFlexGap
        sx={{ gap: 1.5 }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography
            sx={{
              fontFamily: tokens.serif,
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: '-.01em',
              color: tokens.ink,
            }}
          >
            Execution trace
          </Typography>
          <Typography sx={{ mt: 0.2, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
            Perfetto · per-worker slice timeline
          </Typography>
        </Box>

        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 0.75 }}>
          <Stack direction="row" role="group" aria-label="Trace" sx={{ gap: 0.5 }}>
            {TRACE_NAMES.map((name) => {
              const selected = name === traceName;
              return (
                <Button
                  key={name}
                  size="small"
                  aria-pressed={selected}
                  onClick={() => setTraceName(name)}
                  sx={{
                    minWidth: 0,
                    px: 1.2,
                    py: 0.45,
                    borderRadius: 5,
                    border: `1px solid ${selected ? tokens.teal : tokens.hair}`,
                    background: selected ? tokens.leafbg : tokens.tile2,
                    color: selected ? tokens.teal : tokens.sub,
                    fontFamily: tokens.mono,
                    fontSize: 10.5,
                    lineHeight: 1.4,
                    '&:hover': {
                      borderColor: tokens.teal,
                      background: tokens.leafbg,
                      color: tokens.teal,
                    },
                  }}
                >
                  {name}
                </Button>
              );
            })}
          </Stack>
          <IconButton
            size="small"
            aria-label="Reload trace"
            title="Reload trace"
            disabled={!expanded}
            onClick={() => setReloadKey((key) => key + 1)}
            sx={{
              width: 29,
              height: 29,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 1.5,
              color: tokens.sub,
              '&:hover': {
                borderColor: tokens.teal,
                background: tokens.leafbg,
                color: tokens.teal,
              },
              '&.Mui-disabled': { borderColor: tokens.hair, color: tokens.sub2 },
            }}
          >
            <RefreshRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Button
            size="small"
            onClick={() => setExpanded((open) => !open)}
            sx={{
              minWidth: 103,
              px: 1.35,
              py: 0.55,
              borderRadius: 1.5,
              border: `1px solid ${tokens.teal}`,
              background: expanded ? tokens.teal : tokens.leafbg,
              color: expanded ? tokens.leafbg : tokens.teal,
              fontFamily: tokens.mono,
              fontSize: 10.5,
              '&:hover': {
                background: expanded ? tokens.ink : tokens.tile2,
                borderColor: expanded ? tokens.ink : tokens.teal,
              },
            }}
          >
            {expanded ? 'Close ▾' : 'Open trace ▸'}
          </Button>
        </Stack>
      </Stack>

      {expanded && (
        <Box sx={{ mt: 1.5 }}>
          {statusText && (
            <Typography
              role="status"
              sx={{
                mb: 0.7,
                fontFamily: tokens.mono,
                fontSize: 10,
                color:
                  status === 'error'
                    ? tokens.terra
                    : status === 'loaded'
                      ? tokens.teal
                      : tokens.sub,
              }}
            >
              {statusText}
            </Typography>
          )}
          <Box
            sx={{
              overflow: 'hidden',
              borderRadius: 1.5,
              border: `1px solid ${tokens.hair}`,
              background: tokens.tile2,
            }}
          >
            <Box
              ref={iframeRef}
              component="iframe"
              src="https://ui.perfetto.dev/#!/?mode=embedded"
              width="100%"
              height="620px"
              title="Perfetto"
              sx={{ display: 'block', border: 'none' }}
            />
          </Box>
        </Box>
      )}
    </Paper>
  );
}
