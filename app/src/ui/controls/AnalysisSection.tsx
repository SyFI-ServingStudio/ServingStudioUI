import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import { tokens } from '../theme';
import { SurfaceAccentProvider } from './SurfaceCard';

export interface AnalysisSectionProps {
  readonly idx: string;
  readonly title: string;
  readonly sub?: string;
  readonly accent: string;
  readonly controls?: ReactNode;
  readonly children: ReactNode;
}

/** The existing Analyzer section chrome, shared by both application shells. */
export default function AnalysisSection({
  idx,
  title,
  sub,
  accent,
  controls,
  children,
}: AnalysisSectionProps) {
  const headingId = `run-section-${idx}`;
  return (
    <SurfaceAccentProvider accent={accent}>
      <Box component="section" aria-labelledby={headingId} sx={{ mt: 2 }}>
        <Stack
          direction="row"
          alignItems="baseline"
          flexWrap="wrap"
          useFlexGap
          spacing={1.5}
          sx={{ mx: 0.25, mb: 1.25 }}
        >
          <Box
            component="span"
            sx={{ fontFamily: tokens.body, fontSize: 12, color: accent, letterSpacing: '.1em' }}
          >
            {idx}
          </Box>
          <Typography
            id={headingId}
            component="h2"
            sx={{
              fontFamily: tokens.serif,
              fontWeight: 600,
              fontSize: 17,
              letterSpacing: '-.01em',
            }}
          >
            {title}
          </Typography>
          {(controls || sub) && (
            <Stack
              direction="row"
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ ml: 'auto', gap: 1 }}
            >
              {controls}
              {sub && (
                <Typography
                  sx={{
                    fontFamily: tokens.body,
                    fontSize: 12,
                    color: tokens.sub,
                    textAlign: 'right',
                  }}
                >
                  {sub}
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
        {children}
      </Box>
    </SurfaceAccentProvider>
  );
}
