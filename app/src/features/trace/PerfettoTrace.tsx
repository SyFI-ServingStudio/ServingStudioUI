import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import type { TraceResource } from '../../domain/artifacts';
import { tokens } from '../../theme';
import {
  fetchTraceBuffer,
  PERFETTO_EMBED_URL,
  PERFETTO_ORIGIN,
  resolveSameOriginTraceUrl,
  traceFileName,
} from './perfettoBridge';
import { useActiveTraceResource } from './useTraceResource';

type TraceLoadStatus = 'idle' | 'connecting' | 'loading' | 'loaded' | 'error';

function resourceReason(resource: TraceResource | undefined): string {
  if (resource === undefined) return 'This run does not declare a Perfetto trace.';
  if (resource.status === 'ready') return 'Trace available on demand.';
  if ('reason' in resource && resource.reason) return resource.reason;
  return `Perfetto trace is ${resource.status.replace('_', ' ')}.`;
}

/** Lazy, repository-backed Perfetto viewer. The iframe channel is unbuffered,
 * so every new frame completes the documented PING/PONG handshake before the
 * current run's trace bytes are posted. */
export default function PerfettoTrace() {
  const [expanded, setExpanded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<TraceLoadStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  const { run, descriptorTrace, query } = useActiveTraceResource('perfetto', expanded);
  const resolvedTrace = query.data;
  const traceReady = descriptorTrace?.status === 'ready';
  const traceAddress = resolvedTrace?.status === 'ready' ? resolvedTrace.artifact.href : null;

  useEffect(() => {
    if (!expanded) {
      readyRef.current = false;
      setStatus('idle');
      setLoadError(null);
      return;
    }
    if (traceAddress === null) return;

    const iframe = iframeRef.current;
    const perfettoWindow = iframe?.contentWindow;
    if (!iframe || !perfettoWindow) return;

    const abortController = new AbortController();
    let disposed = false;

    const clearPing = () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const postTrace = async () => {
      setStatus('loading');
      setLoadError(null);
      try {
        const traceUrl = resolveSameOriginTraceUrl(traceAddress, window.location.href);
        const buffer = await fetchTraceBuffer(
          window.fetch.bind(window),
          traceUrl,
          abortController.signal,
        );
        if (disposed || iframeRef.current !== iframe || iframe.contentWindow !== perfettoWindow) {
          return;
        }
        perfettoWindow.postMessage(
          {
            perfetto: {
              buffer,
              title: `${run.name} · execution trace`,
              fileName: traceFileName(traceUrl),
              keepApiOpen: true,
              localOnly: true,
            },
          },
          PERFETTO_ORIGIN,
        );
        setStatus('loaded');
      } catch (error) {
        if (disposed || abortController.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load the trace.');
        setStatus('error');
      }
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin === PERFETTO_ORIGIN &&
        event.source === iframe.contentWindow &&
        event.data === 'PONG' &&
        !readyRef.current
      ) {
        clearPing();
        readyRef.current = true;
        void postTrace();
      }
    };

    if (readyRef.current) {
      void postTrace();
    } else {
      setStatus('connecting');
      intervalRef.current = window.setInterval(
        () => perfettoWindow.postMessage('PING', PERFETTO_ORIGIN),
        100,
      );
      window.addEventListener('message', onMessage);
    }

    return () => {
      disposed = true;
      abortController.abort();
      clearPing();
      window.removeEventListener('message', onMessage);
    };
  }, [expanded, reloadKey, run.name, traceAddress]);

  const queryProblem = query.isError
    ? query.error instanceof Error
      ? query.error.message
      : 'Could not resolve the trace resource.'
    : resolvedTrace !== undefined && resolvedTrace.status !== 'ready'
      ? resourceReason(resolvedTrace)
      : null;
  const statusText =
    queryProblem ??
    (status === 'connecting'
      ? 'Connecting to Perfetto…'
      : status === 'loading' || (expanded && query.isPending)
        ? 'Loading current-run trace…'
        : status === 'loaded'
          ? 'Current-run trace loaded.'
          : status === 'error'
            ? (loadError ?? 'Could not load the current-run trace.')
            : resourceReason(descriptorTrace));

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
        <Box sx={{ flex: 1, minWidth: 0 }}>
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
          <Typography
            sx={{
              mt: 0.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: tokens.body,
              fontSize: 12,
              color: tokens.sub,
            }}
          >
            Perfetto · {run.source.simulationFolder}
          </Typography>
        </Box>

        <Stack direction="row" alignItems="center" useFlexGap sx={{ gap: 0.75 }}>
          <IconButton
            size="small"
            aria-label="Reload current-run trace"
            title="Reload current-run trace"
            disabled={!expanded || !traceReady || query.isPending}
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
            disabled={!traceReady}
            onClick={() => setExpanded((open) => !open)}
            sx={{
              minWidth: 103,
              px: 1.35,
              py: 0.55,
              borderRadius: 1.5,
              border: `1px solid ${tokens.teal}`,
              background: expanded ? tokens.teal : tokens.leafbg,
              color: expanded ? tokens.leafbg : tokens.teal,
              fontFamily: tokens.body,
              fontSize: 12,
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

      <Typography
        role={queryProblem !== null || status === 'error' ? 'alert' : 'status'}
        sx={{
          mt: 0.7,
          fontFamily: tokens.body,
          fontSize: 12,
          color:
            queryProblem !== null || status === 'error'
              ? tokens.terra
              : status === 'loaded'
                ? tokens.teal
                : tokens.sub,
        }}
      >
        {statusText}
      </Typography>

      {expanded && (
        <Box sx={{ mt: 1.2 }}>
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
              src={PERFETTO_EMBED_URL}
              width="100%"
              height="620px"
              title={`Perfetto trace for ${run.name}`}
              sx={{ display: 'block', border: 'none' }}
            />
          </Box>
        </Box>
      )}
    </Paper>
  );
}
