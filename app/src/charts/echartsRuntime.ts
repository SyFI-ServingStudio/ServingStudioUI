import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

import { ECHARTS_THEME, ECHARTS_THEME_NAME } from './platform';

// Keep the runtime registry next to the chart option builders. Any new series
// or component used by an option must be registered here and covered by the
// browser smoke tests; importing the full `echarts` entry defeats tree shaking.
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
]);
echarts.registerTheme(ECHARTS_THEME_NAME, ECHARTS_THEME);

export { echarts };
