import { Box } from '@mui/material';

import { subjectStatusLabel, subjectStatusMessage } from '../application/subjectStatus';
import { CHART_THEME } from '../charts/platform';
import ChartCard from '../components/ChartCard';
import type { Slo } from '../domain/run';
import type { SubjectResult } from '../domain/subject';
import { sloMetricOption } from './options';

const SLO_CARDS: ReadonlyArray<{
  key: keyof Slo;
  idx: string;
  title: string;
  color: string;
  caption: string;
}> = [
  {
    key: 'ttft',
    idx: 'a1',
    title: 'TTFT latency',
    color: CHART_THEME.palette[0],
    caption: 'Cumulative distribution of time to first token. The dotted marker shows p90.',
  },
  {
    key: 'tpot',
    idx: 'a2',
    title: 'TPOT latency',
    color: CHART_THEME.palette[1],
    caption: 'Cumulative distribution of time per output token. The dotted marker shows p90.',
  },
  {
    key: 'e2e',
    idx: 'a3',
    title: 'E2E latency',
    color: CHART_THEME.palette[2],
    caption: 'Cumulative distribution of end-to-end request latency. The dotted marker shows p90.',
  },
];

/** One bounded SLO subject, projected into three independently focusable charts.
 * Small screens stack the cards; desktop keeps the three distributions in one row. */
export default function SloChartRow({ subject }: { subject: SubjectResult<'slo'> }) {
  const ready = subject.status === 'ready' ? subject.payload : null;
  const sub = subject.status === 'ready' ? 'request CDF' : subjectStatusLabel(subject);
  const empty = subject.status === 'ready' ? undefined : subjectStatusMessage(subject);

  return (
    <Box
      data-testid="slo-chart-row"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(3,minmax(0,1fr))' },
        gap: 2,
        minWidth: 0,
      }}
    >
      {SLO_CARDS.map((card) => {
        const metric = ready?.[card.key];
        return (
          <ChartCard
            key={card.key}
            idx={card.idx}
            title={card.title}
            sub={sub}
            option={metric === undefined ? null : sloMetricOption(metric, CHART_THEME, card.color)}
            empty={empty}
            caption={card.caption}
          />
        );
      })}
    </Box>
  );
}
