/**
 * A result page: the sections a result's layout resolves to at its address,
 * each panel its own chunk.
 *
 * Shared by the application (`App.tsx`, inside its shell and beside the Agent)
 * and by the embeddable viewer (`src/embed`), so both render exactly the same
 * page for the same `Location`.
 */
import { Alert, Box, Skeleton, Stack, Typography } from '@mui/material';
import { Suspense, lazy, useMemo, useState, type ComponentProps, type ComponentType } from 'react';

import { formatLocation, upTo, withPanel, type Location } from '../location';
import type { ContentPanelSpec, PanelProps } from '../panels/types';
import { PanelEvidenceProvider } from '../panels/PanelEvidenceProvider';
import AnalysisSection from '../ui/controls/AnalysisSection';
import { SectionFrameSubtitleContext } from '../ui/controls/SectionFrameSubtitleContext';
import { SectionPanelToggle } from '../ui/controls/SectionPanelToggle';
import { tokens } from '../ui/theme';
import { pageLayout } from '../ui/theme/metrics';
import { commit } from './commit';
import { resolveResult, type ResolvedSection } from './resolve';

/** A result page as the application frames it: a run in the page column. */
export function ResultMain({ location }: { location: Extract<Location, { view: 'result' }> }) {
  return location.ref.kind === 'run' ? (
    <Box component="main" sx={{ ...pageLayout, mx: 'auto', px: 0, pt: 3.75, pb: 10 }}>
      <ResultBody location={location} />
    </Box>
  ) : (
    <ResultBody location={location} />
  );
}

function ResultBody({ location }: { location: Extract<Location, { view: 'result' }> }) {
  const resolution = useMemo(() => resolveResult(location), [location]);
  switch (resolution.status) {
    case 'unaddressable':
      return (
        <Box>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {resolution.reason}
          </Alert>
          <Address location={location} />
        </Box>
      );
    case 'panel':
      return <LoadedPanel spec={resolution.panel} location={location} />;
    case 'page':
      return <Page sections={resolution.sections} location={location} />;
  }
}

/**
 * The sections of a result page, in layout order.
 *
 * An empty page is reported rather than rendered as blankness: while the port
 * is in progress a kind can legitimately have a layout and no panels yet, and
 * the difference between "nothing here yet" and "something failed" is the whole
 * value of saying it.
 */
function Page({
  sections,
  location,
}: {
  sections: readonly ResolvedSection[];
  location: Extract<Location, { view: 'result' }>;
}) {
  if (sections.length === 0) {
    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          No panel in this build applies at this address yet.
        </Alert>
        <Address location={location} />
      </Box>
    );
  }
  return (
    <Stack spacing={0}>
      {sections.map((section) => {
        const rows = (
          <Stack spacing={section.spacing ?? 2}>
            {section.rows.map((row) => (
              <Box
                key={row.map((spec) => spec.id).join('|')}
                sx={{
                  display: 'grid',
                  gridTemplateColumns:
                    row.length > 1 ? { xs: '1fr', md: `repeat(${row.length},1fr)` } : '1fr',
                  gap: 2,
                }}
              >
                {row.map((spec) => (
                  <LoadedPanel key={spec.id} spec={spec} location={location} />
                ))}
              </Box>
            ))}
          </Stack>
        );
        if (section.frame !== null) {
          const control = section.frame.control;
          return (
            <FramedAnalysisSection
              key={section.title}
              idx={section.frame.idx}
              title={section.frame.title}
              sub={section.frame.sub}
              accent={
                section.frame.accent === 'analysis'
                  ? tokens.sectionAnalysis
                  : section.frame.accent === 'structure'
                    ? tokens.sectionStructure
                    : tokens.gold
              }
              controls={
                control === null ? undefined : (
                  <SectionPanelToggle
                    ariaLabel={control.ariaLabel}
                    value={control.value}
                    options={control.options}
                    onChange={(value) => {
                      const option = control.options.find((candidate) => candidate.value === value);
                      if (option === undefined) return;
                      const focus = withPanel(upTo(location.focus, option.upTo), option.panel);
                      commit({ ...location, focus }, 'push');
                    }}
                  />
                )
              }
            >
              {rows}
            </FramedAnalysisSection>
          );
        }
        return (
          <Stack key={section.title} spacing={2}>
            {section.heading !== false && (
              <Typography variant="overline" color="text.secondary">
                {section.title}
              </Typography>
            )}
            {rows}
          </Stack>
        );
      })}
    </Stack>
  );
}

function FramedAnalysisSection({ sub, ...props }: ComponentProps<typeof AnalysisSection>) {
  const [reportedSub, setReportedSub] = useState<string | undefined>();
  return (
    <SectionFrameSubtitleContext.Provider value={setReportedSub}>
      <AnalysisSection {...props} sub={reportedSub ?? sub} />
    </SectionFrameSubtitleContext.Provider>
  );
}

/**
 * One panel, fetched when it is first rendered.
 *
 * `lazy` is memoised per spec because React treats a new lazy component as a
 * different component: rebuilding it on every render would unmount and remount
 * the panel, discarding its state and re-running its reads on every keystroke
 * elsewhere on the page.
 */
function LoadedPanel({
  spec,
  location,
}: {
  spec: ContentPanelSpec;
  location: Extract<Location, { view: 'result' }>;
}) {
  const Panel = componentFor(spec);
  return (
    <Suspense fallback={<Skeleton variant="rounded" height={220} />}>
      <PanelEvidenceProvider location={location} navigate={commit}>
        <Panel location={location} navigate={commit} />
      </PanelEvidenceProvider>
    </Suspense>
  );
}

const LOADED = new Map<string, ComponentType<PanelProps>>();

function componentFor(spec: ContentPanelSpec): ComponentType<PanelProps> {
  const existing = LOADED.get(spec.id);
  if (existing !== undefined) return existing;
  const created = lazy(async () => ({ default: await spec.load() }));
  LOADED.set(spec.id, created);
  return created;
}

function Address({ location }: { location: Location }) {
  return (
    <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap' }}>
      {formatLocation(location)}
    </Typography>
  );
}
