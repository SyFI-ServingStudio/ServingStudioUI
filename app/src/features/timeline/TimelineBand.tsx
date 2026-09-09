import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useActiveRunSubject } from '../../application/ActiveRunProvider';
import { subjectStatusLabel, subjectStatusMessage } from '../../application/subjectStatus';
import { CHART_THEME } from '../../charts/platform';
import EChart from '../../components/EChart';
import SurfaceCard from '../../components/SurfaceCard';
import { useViz } from '../../store';
import { tokens, withAlpha, colors } from '../../theme';
import { concurrencySparkOption } from './timelineOptions';
import {
  beginTimelineInteraction,
  endTimelineInteraction,
  recordTimelineInput,
} from '../../application/timelineProfiling';

/** Wall-clock TIMELINE (run-level). The backdrop is the number of ACTIVE
 *  (in-flight) requests in the system over time. Drag, click, or use the range
 *  control's arrow keys to set the cursor; it lands a marker on every
 *  time-series chart and resolves an exact operation selection. Selecting an
 *  operation performs the safe reverse direction by placing this cursor at its
 *  start. "All" clears both wall-clock and exact operation selection. */
export default function TimelineBand() {
  const cursorMs = useViz((state) => state.cursorMs);
  const setTime = useViz((state) => state.setTime);
  const concurrency = useActiveRunSubject('concurrency');
  if (concurrency.status !== 'ready') {
    return (
      <SurfaceCard accent={tokens.terra} sx={{ p: '12px 16px' }}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={2}>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
            Timeline
          </Typography>
          <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            {subjectStatusLabel(concurrency)}
          </Typography>
        </Stack>
        <Typography
          role="status"
          sx={{ mt: 0.75, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}
        >
          {subjectStatusMessage(concurrency)}
        </Typography>
      </SurfaceCard>
    );
  }

  const conc = concurrency.payload;
  const spanMs = conc.t_ms[conc.t_ms.length - 1];
  if (spanMs === undefined || spanMs <= 0) {
    return (
      <SurfaceCard accent={tokens.terra} sx={{ p: '12px 16px' }}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
          Timeline
        </Typography>
        <Typography
          role="status"
          sx={{ mt: 0.75, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}
        >
          Concurrency subject is ready but has no positive wall-clock span.
        </Typography>
      </SurfaceCard>
    );
  }
  const cur = cursorMs;
  const frac = cur == null ? null : Math.min(1, Math.max(0, cur / spanMs));

  // active requests at an arbitrary wall-clock ms (nearest sample)
  const activeAt = (ms: number): number | null => {
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < conc.t_ms.length; i++) {
      const d = Math.abs(conc.t_ms[i] - ms);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return conc.active[best];
  };
  const activeNow = cur != null ? activeAt(cur) : null;
  const rangeValue = cur == null ? 0 : Math.round(Math.min(spanMs, Math.max(0, cur)));

  const allSel = cur == null;
  const pill = {
    fontFamily: tokens.body,
    fontSize: 12,
    fontWeight: 600,
    px: 1.25,
    py: 0.5,
    borderRadius: 1.5,
    cursor: 'pointer',
    color: allSel ? tokens.teal : tokens.sub,
    background: allSel ? withAlpha(tokens.teal, 0.1) : 'transparent',
    border: `1px solid ${allSel ? tokens.teal : tokens.hair}`,
    transition: `all .22s ${tokens.ease}`,
    '&:hover': {
      color: allSel ? tokens.teal : tokens.ink,
      borderColor: allSel ? tokens.teal : colors.borderHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${tokens.ink}`,
      outlineOffset: 2,
    },
  };

  return (
    <SurfaceCard accent={tokens.terra} sx={{ p: '12px 16px 10px' }}>
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ gap: 1.5, mb: 0.9 }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 15 }}>
          Timeline
          <Box
            component="span"
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              color: tokens.sub,
              ml: 1.25,
              fontWeight: 400,
            }}
          >
            wall-clock · {(spanMs / 1000).toFixed(0)}s · active requests in system
          </Box>
        </Typography>
        <Box
          sx={{
            ml: 'auto',
            fontFamily: tokens.body,
            fontSize: 12,
            color: cur != null ? tokens.terra : tokens.sub,
            minWidth: 118,
            textAlign: 'right',
          }}
        >
          {cur != null
            ? `t = ${(cur / 1000).toFixed(2)}s · ${activeNow ?? '—'} active`
            : `aggregate · peak ${conc.peak}`}
        </Box>
        <ButtonBase type="button" aria-pressed={allSel} onClick={() => setTime(null)} sx={pill}>
          All
        </ButtonBase>
      </Stack>
      <Box
        sx={{
          position: 'relative',
          height: 50,
          borderRadius: 1.25,
          border: `1px solid ${tokens.hair}`,
          background: tokens.tile2,
          overflow: 'hidden',
          cursor: 'pointer',
          touchAction: 'none',
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
          max={Math.round(spanMs)}
          step={1}
          value={rangeValue}
          aria-label="Simulation time cursor"
          aria-valuetext={
            cur == null
              ? 'Aggregate, no time selected'
              : `${(rangeValue / 1000).toFixed(2)} seconds, ${activeNow ?? 'unknown'} active requests`
          }
          onPointerDown={() => beginTimelineInteraction('pointer')}
          onPointerUp={(event) => endTimelineInteraction(Number(event.currentTarget.value))}
          onPointerCancel={(event) => endTimelineInteraction(Number(event.currentTarget.value))}
          onKeyDown={() => beginTimelineInteraction('keyboard')}
          onKeyUp={(event) => endTimelineInteraction(Number(event.currentTarget.value))}
          onChange={(event) => {
            const atMs = Number(event.currentTarget.value);
            recordTimelineInput(atMs);
            setTime(atMs);
          }}
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
        <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <EChart
            option={concurrencySparkOption(conc, spanMs, CHART_THEME)}
            ariaLabel="Request concurrency over simulation time"
          />
        </Box>
        {frac != null && (
          <>
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${frac * 100}%`,
                width: '2px',
                background: tokens.terra,
                pointerEvents: 'none',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: `${frac * 100}%`,
                transform: 'translate(-50%,-50%)',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: tokens.terra,
                border: `2px solid ${colors.tooltipText}`,
                boxShadow: tokens.shadow,
                pointerEvents: 'none',
              }}
            />
          </>
        )}
      </Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ mt: 0.4, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}
      >
        <span>0s</span>
        <span>active requests in flight ↑ · drag or use arrow keys</span>
        <span>{(spanMs / 1000).toFixed(0)}s</span>
      </Stack>
    </SurfaceCard>
  );
}
