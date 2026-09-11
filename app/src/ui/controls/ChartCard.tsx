import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import type { EChartsOption } from 'echarts';
import type { ReactNode } from 'react';

import { colors, tokens } from '../theme';
import { useOpenChartFocus } from './ChartFocusContext';
import EChart from './EChart';
import {
  EvidenceSurfaceCard,
  EvidenceTitleButton,
  type EvidenceSurfaceCardProps,
} from './EvidenceSurfaceCard';
import SurfaceCard from './SurfaceCard';
import { useChartEvidenceSelection } from './ChartEvidenceContext';

export interface ChartEvidenceSelection {
  readonly evidenceId: string;
  readonly selectedForAgent: boolean;
  readonly onEvidenceSelect: () => void;
}

export interface ChartCardProps {
  readonly testId?: string;
  readonly evidenceId?: string;
  readonly evidence?: ChartEvidenceSelection;
  readonly idx?: string;
  readonly title: string;
  readonly sub?: string;
  readonly option: EChartsOption | null;
  readonly note?: string | null;
  readonly caption?: string;
  readonly empty?: string;
  readonly controls?: ReactNode;
  readonly height?: number;
}

const cardSx: EvidenceSurfaceCardProps['sx'] = {
  p: '16px 16px 14px',
  position: 'relative',
  transition: `box-shadow .4s ${tokens.ease}, border-color .3s ${tokens.ease}`,
  '&:hover': { borderColor: colors.axis, boxShadow: tokens.shadowLift },
  '&:hover .expand, &:focus-within .expand': { opacity: 1 },
};

/**
 * The existing chart tile, independent of application state.
 *
 * A legacy screen can supply its store-backed evidence selection while a
 * location-first panel can render the same card before the evidence bridge is
 * installed. The chart, typography, empty state, and focus interaction remain
 * one implementation in both paths.
 */
export default function ChartCard(props: ChartCardProps) {
  const contextualEvidence = useChartEvidenceSelection(props.evidenceId);
  const evidence = props.evidence ?? contextualEvidence;
  const content = <ChartCardContent {...props} evidence={evidence} />;
  if (evidence === undefined) {
    return (
      <SurfaceCard data-testid={props.testId} sx={cardSx}>
        {content}
      </SurfaceCard>
    );
  }
  return (
    <EvidenceSurfaceCard
      evidenceId={evidence.evidenceId}
      selectedForAgent={evidence.selectedForAgent}
      onEvidenceSelect={evidence.onEvidenceSelect}
      badgePlacement="top-edge"
      data-testid={props.testId}
      sx={cardSx}
    >
      {content}
    </EvidenceSurfaceCard>
  );
}

function ChartCardContent({
  idx,
  title,
  sub,
  option,
  note,
  caption,
  empty,
  controls,
  height = 216,
  evidence,
}: ChartCardProps) {
  const openFocus = useOpenChartFocus();
  return (
    <>
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
          {evidence === undefined ? (
            title
          ) : (
            <EvidenceTitleButton label={title}>{title}</EvidenceTitleButton>
          )}
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
    </>
  );
}
