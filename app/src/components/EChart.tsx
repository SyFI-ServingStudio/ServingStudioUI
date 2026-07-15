import type { EChartsOption } from 'echarts';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { CSSProperties } from 'react';

import { echarts } from '../charts/echartsRuntime';
import { ECHARTS_THEME_NAME } from '../charts/platform';

/** Thin wrapper around echarts-for-react — fills its parent, canvas renderer,
 *  replaces (not merges) options so scope changes redraw cleanly. */
export default function EChart({
  option,
  style,
  ariaLabel,
}: {
  option: EChartsOption;
  style?: CSSProperties;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height: '100%', width: '100%', ...style }}>
      <ReactEChartsCore
        echarts={echarts}
        theme={ECHARTS_THEME_NAME}
        option={option}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
