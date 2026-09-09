import { pageLayout } from '../../theme/metrics';
import { Alert, Box, Skeleton, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import {
  useAlignmentDescriptorQuery,
  useAlignmentBreakdownQuery,
  useAlignmentE2eSeriesQuery,
  useAlignmentIterationReportQuery,
  useAlignmentIterationSeriesQuery,
  useAlignmentTimelineIndexQuery,
  useAlignmentTimelineIterationQuery,
  useAlignmentWorkloadSeriesQuery,
} from '../../application/queries';
import { workspaceIdFromLocation } from '../../application/workspaceRoute';
import { SurfaceAccentProvider } from '../../components/SurfaceCard';
import type { AlignmentDescriptor, AlignmentSubjectName } from '../../domain/alignment';
import { tokens } from '../../theme';
import MappingBoardCard from './MappingBoardCard';
import OperationSplitCard from './OperationSplitCard';
import PairedIterationsCard from './PairedIterationsCard';
import SubjectError from './SubjectError';
import WallClockCard from './WallClockCard';
import WholeRunCard from './WholeRunCard';
import { initialAlignmentIterationId } from './iterationPicker';
import { defaultBoardExampleIterationId } from './mappingBoardModel';
import { predictionHref } from './predictionLink';

/**
 * An alignment bundle: how far the model is from the machine.
 *
 * The five sections read the two analysis halves independently, and a bundle
 * with only one of them renders the sections it can rather than failing whole.
 * Each half is fetched per subject for the same reason.
 */
export default function AlignmentPage({ alignmentId }: { alignmentId: string }) {
  const descriptor = useAlignmentDescriptorQuery(alignmentId);
  // Per subject, not per half. A half can be complete while one of its
  // subjects was never generated — an older bundle analysed before that
  // subject existed is the ordinary case — and asking for it anyway turns a
  // known-absent document into a 404.
  const subjectReady = (subject: AlignmentSubjectName) =>
    descriptor.data?.subjects[subject].status === 'ready';
  const hasDetail = (subject: AlignmentSubjectName) =>
    descriptor.data?.subjects[subject].hasIterationDetail === true;

  const report = useAlignmentIterationReportQuery(alignmentId, subjectReady('iteration'));
  const series = useAlignmentIterationSeriesQuery(alignmentId, subjectReady('iteration'));
  const timeline = useAlignmentTimelineIndexQuery(alignmentId, subjectReady('timeline'));
  const workload = useAlignmentWorkloadSeriesQuery(alignmentId, subjectReady('workload'));
  const e2e = useAlignmentE2eSeriesQuery(alignmentId, subjectReady('e2e'));

  const timelineExists = subjectReady('timeline');
  const [selectedIterationId, setSelectedIterationId] = useState<number | null>(null);
  const boardExampleIterationId =
    series.data?.sequences !== null &&
    series.data?.sequences !== undefined &&
    report.data !== undefined
      ? defaultBoardExampleIterationId(series.data.sequences, report.data)
      : null;
  // The default selection depends on which iterations the analyzer
  // distinguished, so it can only be chosen once an index has arrived. The
  // timeline is the better source — it says which iterations were singled out —
  // but a bundle analysed before that subject existed has none, and seeding
  // from the timeline alone left every section that needs a selected iteration
  // permanently empty on exactly those bundles.
  useEffect(() => {
    if (selectedIterationId !== null) return;
    if (timeline.data !== undefined) {
      setSelectedIterationId(
        initialAlignmentIterationId(timeline.data.iterations, boardExampleIterationId),
      );
      return;
    }
    if (timelineExists) return;
    const fallback =
      boardExampleIterationId ??
      series.data?.iterations[Math.floor((series.data.iterations.length - 1) / 2)]?.iterationId;
    if (fallback !== undefined && fallback !== null) setSelectedIterationId(fallback);
  }, [boardExampleIterationId, selectedIterationId, series.data, timeline.data, timelineExists]);

  const iteration = useAlignmentTimelineIterationQuery(
    alignmentId,
    hasDetail('timeline') ? selectedIterationId : null,
  );
  const breakdown = useAlignmentBreakdownQuery(
    alignmentId,
    hasDetail('iteration') ? selectedIterationId : null,
  );
  const workspaceId = workspaceIdFromLocation();
  if (!descriptor.supported) {
    return (
      <PageFrame title="Alignment">
        <Alert severity="info" sx={{ fontSize: 12 }}>
          Alignment bundles require the live Analyzer service.
        </Alert>
      </PageFrame>
    );
  }
  if (descriptor.isPending) {
    return (
      <PageFrame title="Alignment">
        <Skeleton variant="rounded" height={320} />
      </PageFrame>
    );
  }
  if (descriptor.isError || descriptor.data === undefined) {
    return (
      <PageFrame title="Alignment">
        <Alert severity="error" sx={{ fontSize: 12 }}>
          {descriptor.error instanceof Error
            ? descriptor.error.message
            : 'This alignment bundle could not be read.'}
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame title={descriptor.data.displayName}>
      <Stack sx={{ gap: 3 }}>
        {descriptor.data.lifecycle.kernelAnalysis !== 'complete' && (
          <Alert severity="info" sx={{ fontSize: 12 }}>
            The kernel half of this bundle is {descriptor.data.lifecycle.kernelAnalysis}; sections
            01 to 04 need it.
          </Alert>
        )}

        <SurfaceAccentProvider accent={tokens.teal}>
          <Section
            index="01"
            title="Every iteration, paired"
            why="One point per measured iteration, not one number for the run. The middle panel is where the model is wrong; the bottom panel is whether being wrong accumulates."
          >
            <SubjectBody
              descriptor={descriptor.data}
              subjects={['iteration']}
              queries={[series]}
              height={420}
            >
              {series.data ? <PairedIterationsCard series={series.data} /> : null}
            </SubjectBody>
          </Section>
        </SurfaceAccentProvider>

        <SurfaceAccentProvider accent={tokens.sectionStructure}>
          <Section
            index="02"
            title="What is in the comparison, and what is not"
            why="Every pair above is a sum over kernels a label file tied to a modelled slot. Here is that label file as a board: what vLLM ran on top, what the model prices underneath, and a ribbon wherever the two are joined."
          >
            <SubjectBody
              descriptor={descriptor.data}
              subjects={['iteration']}
              queries={[report, series]}
              height={360}
            >
              {breakdown.isError ? (
                <SubjectError error={breakdown.error} />
              ) : report.data && series.data ? (
                <MappingBoardCard
                  alignmentId={alignmentId}
                  report={report.data}
                  series={series.data}
                  breakdown={breakdown.data ?? null}
                  selectedIterationId={selectedIterationId}
                  onSelectIteration={setSelectedIterationId}
                />
              ) : null}
            </SubjectBody>
          </Section>
        </SurfaceAccentProvider>

        <SurfaceAccentProvider accent={tokens.sectionAnalysis}>
          <Section
            index="03"
            title="One cycle, split by operation"
            why="A point in §01 is one cycle reduced to one number. Here that number is opened up: the measured kernels and the modelled slots of a chosen cycle as two stacks on one millisecond axis, and below them where their difference accumulates."
          >
            <SubjectBody
              descriptor={descriptor.data}
              subjects={['iteration']}
              queries={[report]}
              height={320}
            >
              {report.data ? (
                <OperationSplitCard
                  report={report.data}
                  breakdown={breakdown.data ?? null}
                  breakdownLoading={hasDetail('iteration') && breakdown.isPending}
                  breakdownError={breakdown.error}
                  selectedIterationId={selectedIterationId}
                  onSelectIteration={setSelectedIterationId}
                  prediction={
                    descriptor.data.prediction === null
                      ? null
                      : {
                          href: predictionHref(
                            workspaceId,
                            descriptor.data.prediction.predictionId,
                          ),
                          displayName: descriptor.data.prediction.displayName,
                        }
                  }
                />
              ) : null}
            </SubjectBody>
          </Section>
        </SurfaceAccentProvider>

        <SurfaceAccentProvider accent={tokens.terra}>
          <Section
            index="04"
            title="Where one iteration's wall clock went"
            why="A percentage says how wrong the model is. The span says where the GPU was while being wrong — and how much of it no kernel occupied at all, which is the part the multiplier exists to cover. The bar and the lanes are the same iteration at two zooms. The host lanes sit above the device because that is the order things happen in: a GPU gap under a run of launches is the device behind the host, a GPU gap under an idle host is the other way round, and the model has no lane at all up there."
          >
            <SubjectBody
              descriptor={descriptor.data}
              subjects={['timeline']}
              queries={[timeline]}
              height={420}
            >
              {timeline.data ? (
                <WallClockCard
                  alignmentId={alignmentId}
                  index={timeline.data}
                  iteration={iteration.data ?? null}
                  iterationError={iteration.error}
                  loading={iteration.isPending}
                  selectedIterationId={selectedIterationId}
                  onSelectIteration={setSelectedIterationId}
                />
              ) : null}
            </SubjectBody>
          </Section>
        </SurfaceAccentProvider>

        <SurfaceAccentProvider accent={tokens.olive}>
          <Section
            index="05"
            title="The whole run"
            why="The loosest question, and the one with two ways to be right — only one of them is the model being right. Every result is one card; the workload each side actually scheduled sits under them, because that is what tells the two apart."
          >
            <SubjectBody
              descriptor={descriptor.data}
              subjects={[]}
              queries={[
                ...(subjectReady('workload') ? [workload] : []),
                ...(subjectReady('e2e') ? [e2e] : []),
              ]}
              height={320}
            >
              <WholeRunCard e2e={e2e.data ?? null} workload={workload.data ?? null} />
            </SubjectBody>
          </Section>
        </SurfaceAccentProvider>
      </Stack>
    </PageFrame>
  );
}

/**
 * One section's body, driven by the queries that feed it.
 *
 * A subject that failed to load says so. Rendering nothing in its place would
 * make a parse failure — the app disagreeing with the analyzer about a field —
 * look exactly like a bundle that legitimately has no such subject, and that
 * is the one failure mode this page must not hide.
 */
function SubjectBody({
  descriptor,
  subjects,
  queries,
  height,
  children,
}: {
  descriptor: AlignmentDescriptor;
  /** Subjects this section cannot draw without. A section that degrades one
   * side at a time names none and handles the absence itself. */
  subjects: readonly AlignmentSubjectName[];
  queries: readonly { isPending: boolean; isError: boolean; error: unknown }[];
  height: number;
  children: React.ReactNode;
}) {
  const absent = subjects.filter((subject) => descriptor.subjects[subject].status !== 'ready');
  if (absent.length > 0) {
    return (
      <Alert severity="info" sx={{ fontSize: 12 }}>
        {absent.map((subject) => SUBJECT_LABELS[subject]).join(' and ')} not generated for this
        bundle.
      </Alert>
    );
  }
  const failed = queries.find((query) => query.isError);
  if (failed !== undefined) return <SubjectError error={failed.error} />;
  if (queries.some((query) => query.isPending)) {
    return <Skeleton variant="rounded" height={height} />;
  }
  return children;
}

/** What each subject is called when it has to be named as absent. */
const SUBJECT_LABELS: Readonly<Record<AlignmentSubjectName, string>> = {
  iteration: 'Paired iterations',
  timeline: 'Iteration timeline',
  workload: 'Workload comparison',
  e2e: 'End-to-end comparison',
};

function PageFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ py: 3, ...pageLayout, mx: 'auto' }}>
      <Stack sx={{ mb: 2.5, gap: 0.5 }}>
        <Typography
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            color: tokens.terra,
            letterSpacing: '.03em',
          }}
        >
          ALIGNMENT
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 34,
            letterSpacing: '-.015em',
            m: 0,
          }}
        >
          {title}
        </Typography>
      </Stack>
      {children}
    </Box>
  );
}

/**
 * One section head: index, title and the sentence that says why the section
 * exists, on one baseline-aligned row.
 *
 * The three sit together rather than stacked because the sentence is the
 * subtitle of the heading, not a paragraph under it — and because a stacked
 * head pushes every card a line further down on a page that already scrolls
 * five sections deep.
 */
function Section({
  index,
  title,
  why,
  children,
}: {
  index: string;
  title: string;
  why: string;
  children: React.ReactNode;
}) {
  return (
    <Stack component="section" sx={{ gap: 1.25 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', gap: 1.6, flexWrap: { xs: 'wrap', md: 'nowrap' } }}
      >
        <Typography
          sx={{
            fontFamily: tokens.body,
            fontSize: 12,
            letterSpacing: '.03em',
            color: tokens.terra,
            flex: '0 0 auto',
          }}
        >
          {index}
        </Typography>
        <Typography
          component="h2"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 21,
            letterSpacing: '-.012em',
            m: 0,
            whiteSpace: { md: 'nowrap' },
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{ color: tokens.sub, fontSize: 12.5, lineHeight: 1.5, flex: 1, minWidth: 0 }}
        >
          {why}
        </Typography>
      </Stack>
      {children}
    </Stack>
  );
}
