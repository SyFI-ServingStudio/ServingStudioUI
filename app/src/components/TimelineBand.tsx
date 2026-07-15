import { useRef, useState } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { useViz } from '../store';
import { useActiveRun } from '../application/ActiveRunProvider';
import { concurrencySparkOption, CHART_THEME } from '../charts/options';
import { tokens } from '../theme';
import EChart from './EChart';

/** Wall-clock TIMELINE (run-level). The backdrop is the number of ACTIVE
 *  (in-flight) requests in the system over time. Click or drag to set the
 *  cursor; it lands a marker on every time-series chart AND the Iteration band
 *  snaps the current worker to the nearest step. "All" clears it. */
export default function TimelineBand() {
  const st = useViz();
  const run = useActiveRun();
  const tp = run.payloads.throughput;
  const conc = run.payloads.concurrency;
  const spanMs = tp.t_end_ms[tp.t_end_ms.length - 1] || 1;
  const cur = st.cursorMs;
  const frac = cur == null ? null : Math.min(1, Math.max(0, cur / spanMs));

  // active requests at an arbitrary wall-clock ms (nearest sample)
  const activeAt = (ms: number): number | null => {
    if (!conc) return null;
    let best = 0, bd = Infinity;
    for (let i = 0; i < conc.t_ms.length; i++) {
      const d = Math.abs(conc.t_ms[i] - ms);
      if (d < bd) { bd = d; best = i; }
    }
    return conc.active[best];
  };
  const activeNow = cur != null ? activeAt(cur) : null;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState(false);

  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    st.setTime(Math.round(f * spanMs));
  };

  const allSel = cur == null;
  const pill = {
    fontFamily: tokens.mono, fontSize: 11, fontWeight: 600, px: 1.25, py: 0.5, borderRadius: 1.5, cursor: 'pointer',
    color: allSel ? tokens.teal : tokens.sub, background: allSel ? 'rgba(31,111,107,.10)' : 'transparent',
    border: `1px solid ${allSel ? tokens.teal : tokens.hair}`, transition: `all .22s ${tokens.ease}`,
    '&:hover': { color: allSel ? tokens.teal : tokens.ink, borderColor: allSel ? tokens.teal : '#cabf9f' },
  };

  return (
    <Paper sx={{ p: '12px 16px 10px', borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 1.5, mb: 0.9 }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
          Timeline
          <Box component="span" sx={{ fontFamily: tokens.mono, fontSize: 10.5, color: tokens.sub, ml: 1.25, fontWeight: 400 }}>
            wall-clock · {(spanMs / 1000).toFixed(0)}s · active requests in system
          </Box>
        </Typography>
        <Box sx={{ ml: 'auto', fontFamily: tokens.mono, fontSize: 11.5, color: cur != null ? tokens.terra : tokens.sub, minWidth: 118, textAlign: 'right' }}>
          {cur != null
            ? `t = ${(cur / 1000).toFixed(2)}s · ${activeNow ?? '—'} active`
            : conc ? `aggregate · peak ${conc.peak}` : 'aggregate'}
        </Box>
        <Box onClick={() => st.setTime(null)} sx={pill}>All</Box>
      </Stack>
      <Box
        ref={trackRef}
        onPointerDown={(e) => { setDrag(true); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setFromX(e.clientX); }}
        onPointerMove={(e) => { if (drag) setFromX(e.clientX); }}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        sx={{ position: 'relative', height: 50, borderRadius: 1.25, border: `1px solid ${tokens.hair}`, background: tokens.tile2, overflow: 'hidden', cursor: 'pointer', touchAction: 'none' }}
      >
        {conc && (
          <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <EChart option={concurrencySparkOption(conc, spanMs, CHART_THEME)} />
          </Box>
        )}
        {frac != null && (
          <>
            <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${frac * 100}%`, width: '2px', background: tokens.terra, pointerEvents: 'none' }} />
            <Box sx={{ position: 'absolute', top: '50%', left: `${frac * 100}%`, transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: tokens.terra, border: '2px solid #fff', boxShadow: tokens.shadow, pointerEvents: 'none' }} />
          </>
        )}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.4, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
        <span>0s</span><span>active requests in flight ↑ · drag to scrub</span><span>{(spanMs / 1000).toFixed(0)}s</span>
      </Stack>
    </Paper>
  );
}
