import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { EChartsOption } from 'echarts';
import type { ReactNode } from 'react';

import EChart from '../../components/EChart';
import { useOpenChartFocus } from '../../components/ChartFocusContext';
import SurfaceCard from '../../components/SurfaceCard';
import { tokens } from '../../theme';
import type { NoteSegment } from './wholeRunModel';
import { expandedWholeRunOption, LANE_COLORS } from './wholeRunOption';

/**
 * The card §05 repeats.
 *
 * Every result at this level — a latency percentile, a token rate, a
 * scheduler percentile — is one card with the same parts in the same order:
 * the three numbers that state the result, the figure they were read off, the
 * key that gives the rest of each side's distribution, and the analyzer's own
 * account of what was measured. Reading the sixth card takes no more effort
 * than the first because it is laid out identically.
 */

export type StatTone = 'measured' | 'modelled' | 'over' | 'under' | 'flat';

const STAT_COLORS: Readonly<Record<StatTone, string>> = {
  measured: LANE_COLORS.measured,
  modelled: LANE_COLORS.modelled,
  over: tokens.terra,
  under: tokens.teal,
  flat: tokens.ink,
};

export interface StatItem {
  readonly value: string;
  readonly unit?: string;
  readonly label: string;
  readonly tone: StatTone;
}

export interface FigureKeyRow {
  readonly label: string;
  readonly color: string;
  readonly cells: readonly string[];
}

const SEGMENT_COLORS: Readonly<Record<NoteSegment['kind'], string>> = {
  text: tokens.sub,
  strong: tokens.ink,
  highlight: tokens.terra,
};

/**
 * A card's footer, from the pieces the model composed.
 *
 * The analyzer's definition of the metric is not printed here. It is one
 * sentence per card of glossary — correct, long, and identical on every
 * capture — and reading six of them stacked under six figures is what the
 * section looked like before. It moved to the title's tooltip, verbatim and
 * unedited, so the wording still comes from the analyzer and the footer stays
 * the one thing a reader cannot get anywhere else: where this card's result
 * sits against the cards beside it.
 */
export function CardNote({ segments }: { segments: readonly NoteSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <Box
          component="span"
          key={`${segment.kind}-${String(index)}`}
          sx={{ color: SEGMENT_COLORS[segment.kind] }}
        >
          {segment.text}
        </Box>
      ))}
    </>
  );
}

/** The rule and name that separate the three questions this section asks. */
export function SectionHeading({
  title,
  caption,
  first = false,
  action,
}: {
  title: string;
  caption: string;
  first?: boolean;
  action?: ReactNode;
}) {
  return (
    <Box
      sx={{
        gridColumn: '1 / -1',
        mt: first ? 0 : '12px',
        mb: '-3px',
        pt: first ? 0 : '11px',
        borderTop: first ? 0 : `1.5px solid ${tokens.ink}`,
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: 'baseline', gap: '13px', flexWrap: 'wrap', rowGap: '4px', minWidth: 0 }}
        >
          <Typography
            component="h4"
            sx={{
              fontFamily: tokens.serif,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '-.012em',
              m: 0,
            }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontSize: 9.5,
              color: tokens.sub2,
              flex: 1,
              minWidth: 0,
            }}
          >
            {caption}
          </Typography>
        </Stack>
        {action}
      </Stack>
    </Box>
  );
}

function SwatchLabel({ label, color }: { label: string; color: string }) {
  return (
    <Box component="span" sx={{ color: tokens.ink, whiteSpace: 'nowrap' }}>
      <Box
        component="i"
        sx={{
          display: 'inline-block',
          width: 9,
          height: 9,
          borderRadius: '2px',
          mr: '6px',
          verticalAlign: '-1px',
          background: color,
        }}
      />
      {label}
    </Box>
  );
}

/** The numbers the curves are read at — every percentile the payload carries,
 * plus the support, so the card never implies the distribution stops at p90. */
function FigureKey({ rows }: { rows: readonly FigureKeyRow[] }) {
  const columns = 1 + (rows[0]?.cells.length ?? 0);
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, auto)`,
        justifyContent: 'space-between',
        gap: '3px 10px',
        p: '2px 16px 11px',
        fontFamily: tokens.mono,
        fontSize: 9,
        color: tokens.sub,
        fontVariantNumeric: 'tabular-nums',
        alignItems: 'baseline',
        whiteSpace: 'nowrap',
      }}
    >
      {rows.map((row) => (
        <Box key={row.label} sx={{ display: 'contents' }}>
          <SwatchLabel label={row.label} color={row.color} />
          {row.cells.map((cell, cellIndex) => (
            <Box component="span" key={`${row.label}-${String(cellIndex)}`}>
              {cell}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function MetricCard({
  title,
  titleDefinition,
  badge,
  meta,
  stats,
  option,
  figureLabel,
  figureKey,
  note,
  wide = false,
  emphasised = false,
}: {
  title: string;
  /** The analyzer's own definition of what this card measured, verbatim. It is
   * a tooltip rather than a line of the card because it is a glossary entry:
   * the same sentence on every capture, needed once and then never again. */
  titleDefinition?: string;
  badge?: string;
  meta: string;
  stats: readonly StatItem[];
  option: EChartsOption | null;
  figureLabel: string;
  figureKey?: readonly FigureKeyRow[];
  note?: readonly NoteSegment[];
  wide?: boolean;
  emphasised?: boolean;
}) {
  const openFocus = useOpenChartFocus();
  return (
    <SurfaceCard
      sx={{
        display: 'flex',
        flexDirection: 'column',
        p: 0,
        ...(wide ? { gridColumn: '1 / -1' } : {}),
        ...(emphasised ? { borderColor: alpha(tokens.gold, 0.34) } : {}),
      }}
    >
      <Stack sx={{ p: '12px 16px 11px', gap: '7px', borderBottom: `1px solid ${tokens.hair}` }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}
        >
          <Tooltip
            title={titleDefinition ?? ''}
            disableHoverListener={titleDefinition === undefined}
            placement="top-start"
          >
            <Typography
              component="h3"
              sx={{
                fontFamily: tokens.serif,
                fontWeight: 600,
                fontSize: 15.5,
                letterSpacing: '-.01em',
                m: 0,
                cursor: titleDefinition === undefined ? 'default' : 'help',
              }}
            >
              {title}
            </Typography>
          </Tooltip>
          <Stack direction="row" sx={{ alignItems: 'center', gap: '6px' }}>
            {badge !== undefined && (
              <Box
                component="span"
                sx={{
                  fontFamily: tokens.mono,
                  fontSize: 8.5,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  color: tokens.gold,
                  border: `1px solid ${alpha(tokens.gold, 0.3)}`,
                  background: alpha(tokens.gold, 0.07),
                  borderRadius: '5px',
                  p: '2px 7px',
                  whiteSpace: 'nowrap',
                }}
              >
                {badge}
              </Box>
            )}
            {option !== null && (
              <Tooltip title="Expand to full screen">
                <IconButton
                  aria-label={`Expand ${title}`}
                  size="small"
                  onClick={() =>
                    openFocus({
                      title,
                      caption: figureLabel,
                      option: expandedWholeRunOption(option),
                      fullScreen: true,
                      interactionHint:
                        'Wheel to zoom · drag the plot to pan · drag the slider to scroll',
                    })
                  }
                  sx={{
                    color: tokens.sub,
                    border: `1px solid ${tokens.hair}`,
                    borderRadius: 1.25,
                    '&:hover': { color: '#fff', background: tokens.teal },
                    '&:focus-visible': {
                      color: tokens.teal,
                      outline: `2px solid ${tokens.teal}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  <OpenInFullIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>
        <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2 }}>
          {meta}
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '9px 26px',
          alignItems: 'baseline',
          p: '15px 17px 7px',
        }}
      >
        {stats.map((stat) => (
          <Box key={stat.label}>
            <Typography
              sx={{
                fontFamily: tokens.serif,
                fontWeight: 600,
                fontSize: 26,
                lineHeight: 1,
                letterSpacing: '-.02em',
                fontVariantNumeric: 'tabular-nums',
                color: STAT_COLORS[stat.tone],
              }}
            >
              {stat.value}
              {stat.unit !== undefined && stat.unit !== '' && (
                <Box
                  component="span"
                  sx={{ fontSize: '.42em', fontWeight: 500, color: tokens.sub, ml: '3px' }}
                >
                  {stat.unit}
                </Box>
              )}
            </Typography>
            <Typography
              sx={{
                fontFamily: tokens.mono,
                fontSize: 9,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: tokens.sub,
                mt: '7px',
              }}
            >
              {stat.label}
            </Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ p: '2px 12px 0' }}>
        {option === null ? (
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontSize: 11,
              color: tokens.sub,
              textAlign: 'center',
              p: '40px 0',
            }}
          >
            {figureLabel}
          </Typography>
        ) : (
          // The design study's figure is a 520 × 200 drawing that scales with
          // the card; holding the ratio keeps the plot the same shape at every
          // column width instead of squashing as the grid reflows.
          <Box sx={{ width: '100%', aspectRatio: '520 / 200' }}>
            <EChart option={option} ariaLabel={figureLabel} />
          </Box>
        )}
      </Box>

      {figureKey !== undefined && <FigureKey rows={figureKey} />}

      {note !== undefined && note.length > 0 && (
        <Box
          sx={{
            mt: 'auto',
            p: '9px 16px 13px',
            borderTop: `1px solid ${tokens.hair}`,
            fontFamily: tokens.mono,
            fontSize: 9.5,
            lineHeight: 1.7,
            color: tokens.sub,
          }}
        >
          <CardNote segments={note} />
        </Box>
      )}
    </SurfaceCard>
  );
}

export interface SummaryRowView {
  readonly label: string;
  readonly measured: string;
  readonly simulated: string;
  readonly measuredFraction: number;
  readonly simulatedFraction: number;
}

function SummaryPair({
  fraction,
  value,
  color,
}: {
  fraction: number;
  value: string;
  color: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <Box
        sx={{
          flex: 1,
          height: 9,
          borderRadius: '3px',
          background: tokens.tile2,
          border: `1px solid ${tokens.hair}`,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'block', height: '100%', width: `${fraction}%`, background: color }} />
      </Box>
      <Box
        component="span"
        sx={{
          fontFamily: tokens.mono,
          fontSize: 9.5,
          color: tokens.ink,
          fontVariantNumeric: 'tabular-nums',
          width: 70,
          textAlign: 'right',
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

/** The percentiles the figures above are read at, for both sides at once. */
export function SummaryCard({
  title,
  meta,
  legend,
  rows,
}: {
  title: string;
  meta: string;
  /** What the two lanes are, beside their swatches. */
  legend: string;
  rows: readonly SummaryRowView[];
}) {
  return (
    <SurfaceCard sx={{ gridColumn: '1 / -1', p: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack sx={{ p: '12px 16px 11px', gap: '7px', borderBottom: `1px solid ${tokens.hair}` }}>
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
          {title}
        </Typography>
        <Typography sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2 }}>
          {meta}
        </Typography>
      </Stack>
      <Box
        sx={{
          p: '14px 17px 15px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(292px, 1fr))',
          gap: '9px 30px',
        }}
      >
        {rows.map((row) => (
          <Box
            key={row.label}
            sx={{
              display: 'grid',
              gridTemplateColumns: '132px minmax(0, 1fr) minmax(0, 1fr)',
              gap: '10px',
              alignItems: 'center',
            }}
          >
            <Box
              component="span"
              sx={{ fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub }}
            >
              {row.label}
            </Box>
            <SummaryPair
              fraction={row.measuredFraction}
              value={row.measured}
              color={LANE_COLORS.measured}
            />
            <SummaryPair
              fraction={row.simulatedFraction}
              value={row.simulated}
              color={LANE_COLORS.modelled}
            />
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          mt: 'auto',
          p: '9px 16px 13px',
          borderTop: `1px solid ${tokens.hair}`,
          fontFamily: tokens.mono,
          fontSize: 9.5,
          lineHeight: 1.7,
          color: tokens.sub,
        }}
      >
        <Stack direction="row" sx={{ gap: '16px', flexWrap: 'wrap' }}>
          <SwatchLabel label="measured" color={LANE_COLORS.measured} />
          <SwatchLabel label="modelled" color={LANE_COLORS.modelled} />
          <Box component="span">{legend}</Box>
        </Stack>
      </Box>
    </SurfaceCard>
  );
}
