import { Box, IconButton, Stack, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import type { EChartsOption } from 'echarts';
import type { ReactNode } from 'react';
import type { EvidenceSurfaceCardProps } from './EvidenceSurfaceCard';
import { useViz } from '../store';
import { tokens, colors } from '../theme';
import { useOpenChartFocus } from './ChartFocusContext';
import EChart from './EChart';
import { EvidenceSurfaceCard, EvidenceTitleButton } from './EvidenceSurfaceCard';

function AnalyzerEvidenceSurfaceCard({
  evidenceId,
  children,
  ...props
}: Omit<EvidenceSurfaceCardProps, 'selectedForAgent' | 'onEvidenceSelect'>) {
  const selectedForAgent = useViz((state) =>
    state.selectionSurface === 'prediction'
      ? state.predictionSelection?.panelId === evidenceId
      : state.selectionSurface === 'run' && state.runPanelId === evidenceId,
  );
  const selectEvidencePanel = useViz((state) => state.selectEvidencePanel);
  return (
    <EvidenceSurfaceCard
      {...props}
      evidenceId={evidenceId}
      selectedForAgent={selectedForAgent}
      onEvidenceSelect={() => selectEvidencePanel(evidenceId)}
    >
      {children}
    </EvidenceSurfaceCard>
  );
}

/** Generic chart tile: header (idx · title · sub), a chart (or empty note), an
 *  optional footnote, and a hover-reveal expand button that pushes the chart
 *  into the shared FocusDialog. Used by every scope stage. */
export default function ChartCard({
  evidenceId,
  idx,
  title,
  sub,
  option,
  note,
  caption,
  empty,
  controls,
  height = 216,
}: {
  evidenceId: string;
  idx?: string;
  title: string;
  sub?: string;
  option: EChartsOption | null;
  note?: string | null;
  caption?: string;
  empty?: string;
  controls?: ReactNode;
  height?: number;
}) {
  const openFocus = useOpenChartFocus();
  return (
    <AnalyzerEvidenceSurfaceCard
      evidenceId={evidenceId}
      badgePlacement="top-edge"
      sx={{
        p: '16px 16px 14px',
        position: 'relative',
        transition: `box-shadow .4s ${tokens.ease}, border-color .3s ${tokens.ease}`,
        '&:hover': { borderColor: colors.axis, boxShadow: tokens.shadowLift },
        '&:hover .expand, &:focus-within .expand': { opacity: 1 },
      }}
    >
      {option && (
        <IconButton
          className="expand"
          aria-label={`Expand ${title}`}
          size="small"
          onClick={() => openFocus({ title, caption: caption ?? note ?? '', option })}
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            opacity: 0,
            color: tokens.sub,
            transition: `all .28s ${tokens.ease}`,
            '&:hover': { color: colors.foregroundOnAccent, background: tokens.teal },
            '&:focus-visible': {
              opacity: 1,
              color: tokens.teal,
              background: tokens.tile2,
              outline: `2px solid ${tokens.teal}`,
              outlineOffset: 2,
            },
            zIndex: 3,
          }}
        >
          <OpenInFullIcon sx={{ fontSize: 15 }} />
        </IconButton>
      )}
      <Stack
        direction={{ xs: controls ? 'column' : 'row', sm: 'row' }}
        alignItems={{ xs: controls ? 'flex-start' : 'baseline', sm: 'baseline' }}
        justifyContent="space-between"
        spacing={{ xs: controls ? 0.75 : 1, sm: 1 }}
        sx={{ mb: 1, pr: 3.5 }}
      >
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-.01em',
            display: 'flex',
            alignItems: 'baseline',
            gap: 1.1,
          }}
        >
          {idx && (
            <Box
              component="span"
              sx={{
                fontFamily: tokens.body,
                fontSize: 12,
                color: tokens.terra,
                letterSpacing: '.1em',
              }}
            >
              {idx}
            </Box>
          )}
          <EvidenceTitleButton label={title}>{title}</EvidenceTitleButton>
        </Typography>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={0.75}
          sx={{ flexShrink: 0, maxWidth: '100%' }}
        >
          {controls}
          {sub && (
            <Typography
              sx={{
                fontFamily: tokens.body,
                fontSize: 12,
                color: tokens.sub,
                textAlign: 'right',
                whiteSpace: 'nowrap',
              }}
            >
              {sub}
            </Typography>
          )}
        </Stack>
      </Stack>
      <Box sx={{ height }}>
        {option ? (
          <EChart option={option} ariaLabel={`${title}. ${caption ?? note ?? ''}`} />
        ) : (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: tokens.sub,
              fontFamily: tokens.body,
              fontSize: 12,
              textAlign: 'center',
              px: 2,
            }}
          >
            {empty ?? note}
          </Box>
        )}
      </Box>
      {option && note && (
        <Typography
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.sub,
            mt: 0.75,
            letterSpacing: '.03em',
          }}
        >
          {note}
        </Typography>
      )}
    </AnalyzerEvidenceSurfaceCard>
  );
}
