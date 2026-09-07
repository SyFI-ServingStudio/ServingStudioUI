import { Box, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMemo, useState, type ReactNode } from 'react';

import SurfaceCard from '../../components/SurfaceCard';
import type { AlignmentIterationSeries } from '../../domain/alignment';
import { tokens } from '../../theme';
import { useAxisZoom } from './axisZoom';
import AxisZoomFootnote from './AxisZoomFootnote';
import { fmtFixed, fmtInt, fmtMultiplier, fmtMsFixed, fmtPctPrecise } from './format';
import PairedIterationsCanvas from './pairedIterationsCanvas';
import {
  PAIRED_SERIES_COLOR,
  PLOT_INSETS,
  densityNote,
  hoverIndexAt,
  iterationDomain,
  pairedLayout,
  pairedSeries,
  viewportNote,
  type PairedFamily,
  type PairedLayout,
  type PairedSeries,
} from './pairedIterationsModel';
import { hoverShapes, pairedScene } from './pairedIterationsScene';
import { iterationTypeColor } from './iterationPalette';

/**
 * §01 — every iteration, paired.
 *
 * One point per measured iteration, not one number for the run: the two lanes'
 * times, the signed relative error under them, and the running relative
 * difference under that. The rail beside the plot is what a single hovered
 * iteration reads as, and what the whole distribution reads as, side by side —
 * the plot answers where, the rail answers how much.
 */
export default function PairedIterationsCard({ series }: { series: AlignmentIterationSeries }) {
  const [familyKey, setFamilyKey] = useState<string>('critical_path');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const paired = useMemo(() => pairedSeries(series), [series]);
  const family = paired.families.find((entry) => entry.key === familyKey) ?? paired.families[0];
  // The three panels and the type strip take their x from one window, because
  // they are one x-aligned figure: zooming a panel on its own would leave the
  // reader comparing a difference against a level measured somewhere else.
  const zoom = useAxisZoom(iterationDomain(paired.iterationId.length), PLOT_INSETS);
  const layout = useMemo(() => pairedLayout(family, zoom.viewport), [family, zoom.viewport]);
  const scene = useMemo(() => pairedScene(paired, family, layout), [paired, family, layout]);
  const overlay = useMemo(
    () => hoverShapes(paired, family, layout, hoverIndex),
    [paired, family, layout, hoverIndex],
  );

  if (layout.count === 0) {
    return (
      <SurfaceCard sx={{ p: '16px' }}>
        <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 11 }}>
          This capture carries no paired iterations.
        </Typography>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard sx={{ p: 0 }}>
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          p: '12px 16px 11px',
          borderBottom: `1px solid ${tokens.hair}`,
          flexWrap: 'wrap',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            alignItems: { sm: 'center' },
            gap: 1,
            minWidth: 0,
            flex: '1 1 380px',
          }}
        >
          <Tooltip title={family.measuredDefinition ?? ''} placement="bottom-start">
            <Typography
              component="h3"
              sx={{
                fontFamily: tokens.serif,
                fontWeight: 600,
                fontSize: 15.5,
                letterSpacing: '-.01em',
                m: 0,
              }}
            >
              {family.measuredLabel} vs {family.simulatedLabel}
            </Typography>
          </Tooltip>
          {family.key === 'gpu_cycle' && (
            <CaptureMultiplier value={fmtMultiplier(series.meta.recommendedGpuTimeMultiplier)} />
          )}
        </Stack>
        <Typography
          sx={{
            fontFamily: tokens.mono,
            fontSize: 9.5,
            color: tokens.sub,
            whiteSpace: 'nowrap',
          }}
        >
          {densityNote(layout)}
        </Typography>
        <ToggleButtonGroup
          exclusive
          value={family.key}
          onChange={(_event, next: string | null) => {
            if (next === null) return;
            setFamilyKey(next);
            setHoverIndex(null);
          }}
          aria-label="time basis"
          sx={{ gap: '4px', flexWrap: 'wrap' }}
        >
          {paired.families.map((entry) => (
            <ToggleButton key={entry.key} value={entry.key} sx={chipSx}>
              {entry.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Legend family={family} typeNames={paired.typeNames} />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) minmax(232px,.28fr)' },
        }}
      >
        <Box sx={{ p: '6px 8px 4px', position: 'relative' }}>
          <PairedIterationsCanvas
            scene={scene}
            overlay={overlay}
            zoom={zoom}
            ariaLabel={`${family.label}: measured and modelled per iteration, relative and cumulative difference. Scroll to zoom the iteration axis, drag to pan`}
            onHoverRatio={(ratio) =>
              setHoverIndex(ratio === null ? null : hoverIndexAt(layout, ratio))
            }
          />
          <Box sx={{ p: '2px 8px 4px' }}>
            <AxisZoomFootnote
              range={viewportNote(paired, layout)}
              isFull={zoom.isFull}
              onReset={zoom.reset}
            />
          </Box>
        </Box>
        <Rail paired={paired} family={family} layout={layout} hoverIndex={hoverIndex} />
      </Box>
    </SurfaceCard>
  );
}

/** The GPU-cycle panel is the only place where the capture-wide correction is
 * actionable: it explains why Timing-predict is larger than kernel time. */
function CaptureMultiplier({ value }: { value: string }) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        gap: 0.9,
        px: '8px',
        py: '5px',
        border: `1px solid ${alpha(tokens.teal, 0.28)}`,
        borderRadius: '7px',
        background: alpha(tokens.teal, 0.05),
        flex: 'none',
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.serif,
          fontSize: 18,
          lineHeight: 1,
          letterSpacing: '-.02em',
          color: tokens.teal,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
      <Stack sx={{ gap: 0.1 }}>
        <Typography
          sx={{
            fontFamily: tokens.mono,
            fontSize: 8.5,
            lineHeight: 1.1,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: tokens.teal,
          }}
        >
          whole capture
        </Typography>
        <Typography sx={{ fontFamily: tokens.mono, fontSize: 8.5, color: tokens.sub2 }}>
          recommended GPU-time correction
        </Typography>
      </Stack>
    </Stack>
  );
}

/** The design's chip: a hairline outline that fills with the section accent
 * when pressed. Both accent steps are derived from the shared token rather
 * than named as separate colours. */
const chipSx = {
  textTransform: 'none',
  border: `1px solid ${tokens.hair}`,
  borderRadius: '6px !important',
  background: 'transparent',
  color: tokens.sub,
  fontFamily: tokens.mono,
  fontSize: 9.5,
  fontWeight: 400,
  lineHeight: 1.5,
  p: '4px 10px',
  transition: `all .25s ${tokens.ease}`,
  '&:hover': { borderColor: tokens.sub2, color: tokens.ink, background: 'transparent' },
  '&.Mui-selected': {
    borderColor: alpha(tokens.teal, 0.42),
    color: tokens.teal,
    background: alpha(tokens.teal, 0.07),
  },
  '&.Mui-selected:hover': { background: alpha(tokens.teal, 0.07), borderColor: tokens.teal },
} as const;

function Legend({ family, typeNames }: { family: PairedFamily; typeNames: readonly string[] }) {
  const lines = [
    { label: family.measuredLabel, color: PAIRED_SERIES_COLOR.measured },
    { label: family.simulatedLabel, color: PAIRED_SERIES_COLOR.modelled },
    { label: 'relative diff', color: PAIRED_SERIES_COLOR.relative },
    { label: 'cumulative diff', color: PAIRED_SERIES_COLOR.cumulative },
  ];
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 16px',
        p: '9px 16px 0',
        alignItems: 'center',
        fontFamily: tokens.mono,
        fontSize: 9,
        color: tokens.sub,
      }}
    >
      {lines.map((entry) => (
        <Box component="span" key={entry.label}>
          <Box
            component="i"
            sx={{
              width: 14,
              height: 3,
              borderRadius: '2px',
              display: 'inline-block',
              mr: '6px',
              verticalAlign: '2px',
              background: entry.color,
            }}
          />
          {entry.label}
        </Box>
      ))}
      {typeNames.map((typeName) => (
        <Box component="span" key={typeName}>
          <Box
            component="i"
            sx={{
              width: 10,
              height: 10,
              borderRadius: '2px',
              display: 'inline-block',
              mr: '6px',
              verticalAlign: '-1px',
              background: iterationTypeColor(typeName, typeNames),
            }}
          />
          {typeName}
        </Box>
      ))}
    </Box>
  );
}

function Rail({
  paired,
  family,
  layout,
  hoverIndex,
}: {
  paired: PairedSeries;
  family: PairedFamily;
  layout: PairedLayout;
  hoverIndex: number | null;
}) {
  const { relativeStats, cumulativeStats, valueStats } = layout;
  return (
    <Stack
      component="aside"
      sx={{
        borderLeft: { lg: `1px solid ${tokens.hair}` },
        borderTop: { xs: `1px solid ${tokens.hair}`, lg: 0 },
        p: '13px 15px 15px',
        gap: '11px',
      }}
    >
      <RailGroup heading="hover readout">
        <HoverReadout paired={paired} family={family} hoverIndex={hoverIndex} />
      </RailGroup>
      <RailGroup heading="relative diff" definition={family.definition}>
        <KeyValueList>
          <KeyValue
            term="run weighted"
            value={fmtPctPrecise(cumulativeStats.last)}
            sign={cumulativeStats.last}
          />
          <KeyValue term="paired" value={fmtInt(relativeStats.n)} />
          <KeyValue
            term="unweighted mean"
            value={fmtPctPrecise(relativeStats.mean)}
            sign={relativeStats.mean}
          />
          <KeyValue term="p50" value={fmtPctPrecise(relativeStats.p50)} sign={relativeStats.p50} />
          <KeyValue term="p90" value={fmtPctPrecise(relativeStats.p90)} sign={relativeStats.p90} />
          <KeyValue
            term="min … max"
            value={`${fmtFixed(relativeStats.min, 1)} … ${fmtFixed(relativeStats.max, 1)}`}
          />
          <KeyValue term="p90 |error|" value={`${fmtFixed(relativeStats.absoluteP90, 2)} %`} />
        </KeyValueList>
      </RailGroup>
      <RailGroup heading="cumulative diff">
        <KeyValueList>
          <KeyValue
            term="final"
            value={fmtPctPrecise(cumulativeStats.last)}
            sign={cumulativeStats.last}
          />
          <KeyValue
            term="min … max"
            value={`${fmtFixed(cumulativeStats.min, 2)} … ${fmtFixed(cumulativeStats.max, 2)}`}
          />
        </KeyValueList>
      </RailGroup>
      <RailGroup heading={family.label} definition={family.measuredDefinition}>
        <KeyValueList>
          <KeyValue term="largest" value={fmtMsFixed(valueStats.max, 3)} />
          <KeyValue term="smallest" value={fmtMsFixed(valueStats.min, 3)} />
          <KeyValue term="iteration types" value={paired.typeNames.join(' · ')} />
        </KeyValueList>
      </RailGroup>
    </Stack>
  );
}

function RailGroup({
  heading,
  definition,
  children,
}: {
  heading: string;
  /** The analyzer's own sentence for what this group counts, verbatim. */
  definition?: string;
  children: ReactNode;
}) {
  const title = (
    <Typography
      component="h4"
      sx={{
        fontFamily: tokens.mono,
        fontSize: 8.5,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        color: tokens.sub,
        m: '0 0 7px',
        pb: '5px',
        borderBottom: `1px solid ${tokens.hair}`,
        fontWeight: 650,
      }}
    >
      {heading}
    </Typography>
  );
  return (
    <Box
      sx={{
        border: `1px solid ${tokens.hair}`,
        borderRadius: '10px',
        background: tokens.leafbg,
        p: '9px 11px 8px',
      }}
    >
      {definition === undefined ? (
        title
      ) : (
        <Tooltip title={definition} placement="left">
          {title}
        </Tooltip>
      )}
      {children}
    </Box>
  );
}

/** Term/value rows belong to a description list; the row wrapper each one
 * needs for its own grid is legal between the list and its terms. */
const KeyValueList = ({ children }: { children: ReactNode }) => (
  <Box component="dl" sx={{ m: 0 }}>
    {children}
  </Box>
);

function KeyValue({ term, value, sign }: { term: string; value: string; sign?: number }) {
  const color = sign === undefined ? tokens.ink : sign >= 0 ? tokens.terra : tokens.teal;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(64px,.85fr) minmax(0,1.15fr)',
        gap: '8px',
        p: '3px 0',
        alignItems: 'baseline',
        '& + &': { borderTop: `1px solid ${tokens.hair}` },
      }}
    >
      <Typography
        component="dt"
        sx={{
          fontFamily: tokens.mono,
          fontSize: 9,
          fontWeight: 650,
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          color: tokens.ink,
          m: 0,
        }}
      >
        {term}
      </Typography>
      <Typography
        component="dd"
        sx={{
          m: 0,
          fontFamily: tokens.mono,
          fontSize: 10.5,
          color,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'right',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function HoverReadout({
  paired,
  family,
  hoverIndex,
}: {
  paired: PairedSeries;
  family: PairedFamily;
  hoverIndex: number | null;
}) {
  const body =
    hoverIndex === null ? (
      <Box component="span" sx={{ color: tokens.sub2 }}>
        move the pointer over the plot to read one iteration
      </Box>
    ) : (
      <>
        {/* An iteration id is an identifier the axis and the pill also print,
            so it stays as the analyzer wrote it rather than being grouped. */}
        iteration <Strong>{String(paired.iterationId[hoverIndex])}</Strong> ·{' '}
        {paired.typeNames[paired.iterationType[hoverIndex]]}
        <br />
        measured <Strong>{fmtFixed(family.measured[hoverIndex] ?? null, 4)}</Strong> ms
        <br />
        modelled <Strong>{fmtFixed(family.simulated[hoverIndex] ?? null, 4)}</Strong> ms
        <br />
        relative <Strong>{fmtPctPrecise(family.relative[hoverIndex] ?? null)}</Strong> · cumulative{' '}
        <Strong>{fmtPctPrecise(family.cumulative[hoverIndex] ?? null)}</Strong>
      </>
    );
  return (
    <Typography
      role="status"
      sx={{
        fontFamily: tokens.mono,
        fontSize: 9.5,
        lineHeight: 1.75,
        color: tokens.sub,
        minHeight: 74,
      }}
    >
      {body}
    </Typography>
  );
}

const Strong = ({ children }: { children: ReactNode }) => (
  <Box component="b" sx={{ color: tokens.ink }}>
    {children}
  </Box>
);
