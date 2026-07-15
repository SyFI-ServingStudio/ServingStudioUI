import { useMemo, useRef } from 'react';
import { Box, IconButton, Paper, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useViz } from '../store';
import { currentWorker, iterTimeline, currentIter } from '../application/runSelection';
import { useActiveRun } from '../application/ActiveRunProvider';
import { PHASE_COLOR, type Iteration } from '../data/iterations';
import { tokens } from '../theme';
import { fmtInt } from '../util';

const WIDE_WINDOW = 41; // fewer columns keep adjacent steps individually targetable
const COMPACT_WINDOW = 13; // keeps touch targets near the 24px minimum on phones
const MARGIN = 12; // deadzone: the window only follows once the step is this close to an edge
const BUF = 60; // extra steps rendered each side of the window so shifts translate smoothly
const BUCKETS = 180; // minimap columns

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Worker-level ITERATION view for NUMEROUS steps. A downsampled minimap shows
 *  the whole run with a viewport box; a windowed detail strip below scrolls to
 *  the cursor's step. The window is STICKY (stays put until the step nears an
 *  edge) and slides SMOOTHLY via a translated buffer track. */
export default function IterationBand() {
  const workerKey = useViz((state) => state.workerKey);
  const cursorMs = useViz((state) => state.cursorMs);
  const setTime = useViz((state) => state.setTime);
  const run = useActiveRun();
  const iterationSelection = useMemo(() => ({ workerKey, cursorMs }), [workerKey, cursorMs]);
  const w = currentWorker(run, iterationSelection);
  const tl = iterTimeline(run, iterationSelection);
  const n = tl.iters.length;
  const sel = currentIter(run, iterationSelection);
  const compact = useMediaQuery('(max-width:600px)');

  const vis = Math.min(compact ? COMPACT_WINDOW : WIDE_WINDOW, n);
  const margin = Math.min(MARGIN, Math.max(3, Math.floor(vis / 4)));
  const maxBatch = Math.max(...tl.iters.map((i) => i.batchTokens), 1);

  // sticky window start — stays put while the step is comfortably inside; once
  // it reaches within MARGIN of an edge, RE-CENTER the step (smoothly, via the
  // translated track), which reopens room on both sides
  const startRef = useRef(0);
  let start = clamp(startRef.current, 0, n - vis);
  if (sel && (sel.id < start + margin || sel.id > start + vis - 1 - margin)) {
    start = clamp(sel.id - (vis >> 1), 0, n - vis);
  }
  startRef.current = start;

  // buffered track so shifts within the buffer animate; re-anchor only when the
  // window would run off the buffer (recomputed to the same on-screen position,
  // so it's invisible — transition is disabled just for that frame)
  const trackCap = Math.min(n, vis + 2 * BUF);
  const maxTrackStart = Math.max(0, n - trackCap);
  const trackStartRef = useRef(0);
  let trackStart = clamp(trackStartRef.current, 0, maxTrackStart);
  const curCount = Math.min(n - trackStart, trackCap);
  const safeLo = trackStart > 0 ? trackStart + 4 : 0;
  const safeHi = trackStart < maxTrackStart ? trackStart + curCount - vis - 4 : n - vis;
  const reanchor = start < safeLo || start > safeHi;
  if (reanchor) trackStart = clamp(start - BUF, 0, maxTrackStart);
  trackStartRef.current = trackStart;
  const trackCount = Math.min(n - trackStart, trackCap);
  const trackIters = tl.iters.slice(trackStart, trackStart + trackCount);
  const translatePct = trackCount > 0 ? -((start - trackStart) / trackCount) * 100 : 0;

  // downsampled minimap over the whole run
  const bw = n / BUCKETS;
  const buckets = Array.from({ length: Math.min(BUCKETS, n) }, (_, b) => {
    const lo = Math.floor(b * bw);
    const hi = Math.max(lo + 1, Math.floor((b + 1) * bw));
    let sum = 0,
      cnt = 0;
    const ph: Record<Iteration['phase'], number> = { prefill: 0, mixed: 0, decode: 0 };
    for (let i = lo; i < hi && i < n; i++) {
      sum += tl.iters[i].batchTokens;
      cnt++;
      ph[tl.iters[i].phase]++;
    }
    const phase = (['prefill', 'mixed', 'decode'] as const).reduce(
      (a, p) => (ph[p] > ph[a] ? p : a),
      'decode' as Iteration['phase'],
    );
    return { avg: cnt ? sum / cnt : 0, phase };
  });
  const maxBucket = Math.max(...buckets.map((b) => b.avg), 1);

  const jumpToStep = (ix: number) => {
    const it = tl.iters[clamp(ix, 0, n - 1)];
    setTime(it.timeMs);
  };
  const moveSelection = (delta: -1 | 1) => {
    if (!sel) return;
    jumpToStep(sel.id + delta);
  };

  const stepControlSx = {
    width: 26,
    height: 26,
    borderRadius: 1,
    border: `1px solid ${tokens.hair}`,
    color: tokens.sub,
    background: tokens.tile2,
    '&:hover': { color: tokens.ink, borderColor: '#cabf9f', background: tokens.leafbg },
    '&.Mui-disabled': { color: tokens.hair, borderColor: tokens.hair },
  };

  return (
    <Paper sx={{ p: '12px 16px 10px', borderRadius: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.5, mb: 0.9 }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
          Iteration
          <Box
            component="span"
            sx={{
              fontFamily: tokens.mono,
              fontSize: 10.5,
              color: tokens.teal,
              ml: 1.25,
              fontWeight: 400,
            }}
          >
            {w.id}
          </Box>
          <Box
            component="span"
            sx={{
              fontFamily: tokens.mono,
              fontSize: 10.5,
              color: tokens.sub,
              ml: 1,
              fontWeight: 400,
            }}
          >
            · {fmtInt(n)} steps · scrub the timeline to scroll · click a step to pin
          </Box>
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Stack direction="row" spacing={1.1}>
            {(['prefill', 'mixed', 'decode'] as const).map((p) => (
              <Box
                key={p}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  color: tokens.sub,
                }}
              >
                <Box sx={{ width: 9, height: 9, borderRadius: 0.5, background: PHASE_COLOR[p] }} />
                {p}
              </Box>
            ))}
          </Stack>
          <Box sx={{ fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub }}>
            window {fmtInt(start)}–{fmtInt(start + vis - 1)}
          </Box>
        </Box>
      </Stack>

      {/* The native range owns both pointer and keyboard selection. The visual
       * minimap remains presentation-only below it. */}
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '1px',
          height: 26,
          mb: 0.9,
          cursor: 'pointer',
          '&:has(> input:focus-visible)': {
            outline: `2px solid ${tokens.ink}`,
            outlineOffset: 2,
          },
        }}
      >
        <Box
          component="input"
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={sel?.id ?? 0}
          aria-label={`Jump to an iteration for worker ${w.ref.poolTag}/${w.ref.workerId}`}
          aria-valuetext={sel ? `Step ${sel.id} of ${n - 1}, ${sel.phase}` : 'No step selected'}
          onChange={(event) => jumpToStep(Number(event.currentTarget.value))}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            m: 0,
            opacity: 0,
            cursor: 'ew-resize',
            zIndex: 2,
          }}
        />
        {buckets.map((b, i) => (
          <Box
            key={i}
            sx={{
              flex: 1,
              minWidth: 0,
              height: `${Math.max(10, (b.avg / maxBucket) * 100)}%`,
              background: PHASE_COLOR[b.phase],
              opacity: 0.5,
              borderRadius: '1px 1px 0 0',
            }}
          />
        ))}
        <Box
          sx={{
            position: 'absolute',
            top: -2,
            bottom: -2,
            left: `${(start / n) * 100}%`,
            width: `${(vis / n) * 100}%`,
            border: `1.5px solid ${tokens.ink}`,
            borderRadius: 0.75,
            background: 'rgba(42,38,34,.05)',
            pointerEvents: 'none',
            transition: `left .18s ${tokens.ease}`,
          }}
        />
        {sel && (
          <Box
            sx={{
              position: 'absolute',
              top: -2,
              bottom: -2,
              left: `${((sel.id + 0.5) / n) * 100}%`,
              width: '2px',
              background: tokens.terra,
              pointerEvents: 'none',
              transition: `left .12s ${tokens.ease}`,
            }}
          />
        )}
      </Box>

      {/* readout + exact one-step controls for dense neighborhoods */}
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.6 }}>
        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            fontFamily: tokens.mono,
            fontSize: 11,
            color: sel ? tokens.ink : tokens.sub,
          }}
        >
          {sel ? (
            <>
              <b style={{ color: tokens.terra }}>step {fmtInt(sel.id)}</b> / {fmtInt(n)} ·{' '}
              {(sel.timeMs / 1000).toFixed(2)}s ·{' '}
              <span style={{ color: PHASE_COLOR[sel.phase] }}>{sel.phase}</span> ·{' '}
              {fmtInt(sel.prefillTokens)} prefill tok + {fmtInt(sel.decodeRequests)} decode req ={' '}
              {fmtInt(sel.batchTokens)} batched
            </>
          ) : (
            <>aggregate — pick a step below, then use the arrow controls for exact navigation</>
          )}
        </Typography>
        <Tooltip title="Previous step" arrow>
          <span>
            <IconButton
              aria-label="Previous step"
              size="small"
              disabled={!sel || sel.id === 0}
              onClick={() => moveSelection(-1)}
              sx={stepControlSx}
            >
              <ChevronLeftIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Next step" arrow>
          <span>
            <IconButton
              aria-label="Next step"
              size="small"
              disabled={!sel || sel.id === n - 1}
              onClick={() => moveSelection(1)}
              sx={stepControlSx}
            >
              <ChevronRightIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {/* scrolling detail window — a translated buffer track slides smoothly */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          height: 58,
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)',
          maskImage: 'linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            height: '100%',
            width: `${(trackCount / vis) * 100}%`,
            transform: `translateX(${translatePct}%)`,
            transition: reanchor ? 'none' : `transform .22s ${tokens.ease}`,
            willChange: 'transform',
          }}
        >
          {trackIters.map((it) => {
            const active = sel?.id === it.id;
            const dim = sel != null && !active;
            return (
              <Tooltip
                key={it.id}
                arrow
                placement="top"
                enterDelay={80}
                title={`step ${fmtInt(it.id)} · ${(it.timeMs / 1000).toFixed(2)}s · ${it.phase} · ${fmtInt(it.batchTokens)} tok`}
              >
                <Box
                  component="button"
                  type="button"
                  aria-label={`Step ${fmtInt(it.id)}, ${it.phase}, ${fmtInt(it.batchTokens)} tokens`}
                  aria-pressed={active}
                  onClick={() => setTime(active ? null : it.timeMs)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      jumpToStep(it.id - 1);
                    }
                    if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      jumpToStep(it.id + 1);
                    }
                  }}
                  sx={{
                    appearance: 'none',
                    flex: '1 1 0',
                    minWidth: 0,
                    height: '100%',
                    p: '0 2px',
                    border: 0,
                    borderRadius: 0.75,
                    background: active ? 'rgba(194,92,58,.11)' : 'transparent',
                    display: 'flex',
                    alignItems: 'flex-end',
                    position: 'relative',
                    cursor: 'pointer',
                    transition: `background .15s ${tokens.ease}`,
                    '&:hover': {
                      background: active ? 'rgba(194,92,58,.15)' : 'rgba(42,38,34,.055)',
                    },
                    '&:focus-visible': { outline: `2px solid ${tokens.ink}`, outlineOffset: -2 },
                  }}
                >
                  {/* The full-height column owns interaction; this inner bar only encodes batch size. */}
                  <Box
                    sx={{
                      width: '100%',
                      height: `${Math.max(10, (it.batchTokens / maxBatch) * 100)}%`,
                      borderRadius: '3px 3px 1px 1px',
                      background: PHASE_COLOR[it.phase],
                      boxShadow: `inset 0 0 0 1px ${tokens.leafbg}`,
                      opacity: dim ? 0.34 : 0.94,
                      outline: active ? `2px solid ${tokens.ink}` : 'none',
                      outlineOffset: -1,
                      transition: `opacity .15s ${tokens.ease}`,
                    }}
                  />
                  {active && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 2,
                        right: 2,
                        bottom: 0,
                        height: 3,
                        background: tokens.terra,
                      }}
                    />
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ mt: 0.4, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}
      >
        <span>step {fmtInt(start)}</span>
        <span>
          {compact
            ? `${vis} of ${fmtInt(n)} · tap or use arrows`
            : `${vis} of ${fmtInt(n)} steps · separated columns · arrow keys move one step`}
        </span>
        <span>step {fmtInt(start + vis - 1)}</span>
      </Stack>
    </Paper>
  );
}
