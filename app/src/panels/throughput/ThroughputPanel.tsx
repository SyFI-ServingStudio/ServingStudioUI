/** The existing throughput chart, reached through the location-first artifact read. */
import { useMemo } from 'react';

import { isPending, throughputSeriesRef, useArtifact } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import ChartCard from '../../ui/controls/ChartCard';
import { describeRead } from '../readProblem';
import type { PanelProps } from '../types';
import { throughputChartData, throughputOption } from './option';

const TITLE = 'Throughput';
const SUBTITLE = 'total ∥ prefill ∥ decode · tok/s';
const CAPTION =
  'Total, prefill, and decode tokens per second over each analyzer interval; the total is emphasized.';

export function RunThroughputPanel({ location }: PanelProps) {
  const state = useArtifact(useMemo(() => throughputSeriesRef(location.ref), [location.ref]));

  if (isPending(state)) {
    return (
      <ChartCard
        evidenceId="throughput"
        testId="throughput-run"
        idx="b"
        title={TITLE}
        sub="loading"
        option={null}
        empty="Loading throughput…"
      />
    );
  }
  if (state.status !== 'ready') {
    const problem = describeRead("This result's throughput subject", state);
    return (
      <ChartCard
        evidenceId="throughput"
        testId="throughput-run"
        idx="b"
        title={TITLE}
        sub={state.status.replace('_', ' ')}
        option={null}
        empty={problem?.message}
        caption={CAPTION}
      />
    );
  }

  const option = throughputOption(
    throughputChartData(state.value),
    CHART_THEME,
    location.focus.cursorMs === null ? undefined : location.focus.cursorMs / 1000,
  );
  return (
    <ChartCard
      evidenceId="throughput"
      testId="throughput-run"
      idx="b"
      title={TITLE}
      sub={SUBTITLE}
      option={option}
      caption={CAPTION}
    />
  );
}
