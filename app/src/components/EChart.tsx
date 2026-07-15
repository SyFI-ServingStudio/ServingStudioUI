import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { CSSProperties } from 'react';

/** Thin wrapper around echarts-for-react — fills its parent, canvas renderer,
 *  replaces (not merges) options so scope changes redraw cleanly. */
export default function EChart({
  option,
  style,
}: {
  option: EChartsOption;
  style?: CSSProperties;
}) {
  return (
    <ReactECharts
      option={option}
      notMerge
      lazyUpdate
      opts={{ renderer: 'canvas' }}
      style={{ height: '100%', width: '100%', ...style }}
    />
  );
}
