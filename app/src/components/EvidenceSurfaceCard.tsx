import { ButtonBase, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { createContext, type ReactNode, useContext } from 'react';

import { tokens } from '../theme';
import SurfaceCard, { type SurfaceCardProps } from './SurfaceCard';

export interface EvidenceSurfaceCardProps extends SurfaceCardProps {
  readonly evidenceId: string;
  readonly selectedForAgent: boolean;
  readonly onEvidenceSelect: () => void;
  readonly badgePlacement?: 'none' | 'top-edge';
}

const selectedBoxShadow = `${tokens.shadow}, 0 9px 38px -8px rgba(31,111,107,.32), 0 0 30px rgba(31,111,107,.18), inset 0 0 28px rgba(31,111,107,.05)`;
const EvidenceSelectionContext = createContext(false);

const selectedSurfaceSx: SxProps<Theme> = {
  outline: `2px solid ${tokens.teal}`,
  outlineOffset: -2,
  boxShadow: selectedBoxShadow,
  '&:hover': {
    borderColor: tokens.teal,
    boxShadow: selectedBoxShadow,
  },
};

/** Shared Agent-evidence boundary. Selection changes only this card shell; the
 * feature-owned chart/content remains a child with stable props. */
export function EvidenceSurfaceCard({
  evidenceId,
  selectedForAgent,
  onEvidenceSelect,
  badgePlacement = 'none',
  onClickCapture,
  sx,
  children,
  ...props
}: EvidenceSurfaceCardProps) {
  const overrides = Array.isArray(sx) ? sx : sx === undefined ? [] : [sx];
  return (
    <EvidenceSelectionContext.Provider value={selectedForAgent}>
      <SurfaceCard
        {...props}
        data-evidence-id={`panel:${evidenceId}`}
        data-agent-selected={selectedForAgent || undefined}
        onClickCapture={(event) => {
          onClickCapture?.(event);
          if (!event.defaultPrevented) onEvidenceSelect();
        }}
        sx={[
          {
            transition: `outline-color 180ms ${tokens.ease}, box-shadow 220ms ${tokens.ease}`,
          },
          ...overrides,
          // Selection owns the outer shell and must remain visible even when a
          // feature adds its ordinary hover shadow.
          ...(selectedForAgent ? [selectedSurfaceSx] : []),
        ]}
      >
        {selectedForAgent && badgePlacement === 'top-edge' && (
          <EvidenceSelectionBadge
            sx={{
              position: 'absolute',
              zIndex: 4,
              top: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              borderTop: 0,
              borderColor: tokens.teal,
              borderRadius: '0 0 7px 7px',
              color: tokens.tile,
              backgroundColor: tokens.teal,
              boxShadow: '0 6px 16px -10px rgba(31,111,107,.9)',
            }}
          />
        )}
        {children}
      </SurfaceCard>
    </EvidenceSelectionContext.Provider>
  );
}

export function EvidenceSelectionBadge({ sx }: { readonly sx?: SxProps<Theme> }) {
  return (
    <Typography
      component="span"
      sx={[
        {
          color: tokens.teal,
          fontFamily: tokens.mono,
          fontSize: 8,
          fontWeight: 600,
          lineHeight: 1.35,
          letterSpacing: '.06em',
          whiteSpace: 'nowrap',
          px: 0.75,
          py: 0.35,
          border: '1px solid rgba(31,111,107,.2)',
          borderRadius: 99,
          backgroundColor: 'rgba(31,111,107,.08)',
          pointerEvents: 'none',
        },
        ...(Array.isArray(sx) ? sx : sx === undefined ? [] : [sx]),
      ]}
    >
      Selected for agent
    </Typography>
  );
}

export function EvidenceTitleButton({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const selectedForAgent = useContext(EvidenceSelectionContext);
  return (
    <ButtonBase
      aria-label={`Select ${label} panel`}
      aria-pressed={selectedForAgent}
      sx={{
        m: -0.25,
        p: 0.25,
        borderRadius: 0.75,
        color: 'inherit',
        font: 'inherit',
        lineHeight: 'inherit',
        transition: `color 140ms ${tokens.ease}`,
        '&:hover': { color: tokens.teal },
        '&:focus-visible': {
          outline: `2px solid ${tokens.teal}`,
          outlineOffset: 2,
        },
      }}
    >
      {children}
    </ButtonBase>
  );
}
