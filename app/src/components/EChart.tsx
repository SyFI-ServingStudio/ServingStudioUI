import type { EChartsOption } from 'echarts';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { CSSProperties } from 'react';

import { echarts } from '../charts/echartsRuntime';
import { ECHARTS_THEME_NAME } from '../charts/platform';

/** Thin wrapper around echarts-for-react — fills its parent, keeps plot text
 * as SVG text, and replaces (not merges) options so scope changes redraw
 * cleanly. Analyzer chart payloads are bounded before reaching this layer; a
 * future canvas exception must therefore be justified by measured density. */
export default function EChart({
  option,
  style,
  ariaLabel,
  onEvents,
}: {
  option: EChartsOption;
  style?: CSSProperties;
  ariaLabel: string;
  onEvents?: Readonly<Record<string, (event: unknown) => void>>;
}) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height: '100%', width: '100%', ...style }}>
      <ReactEChartsCore
        echarts={echarts}
        theme={ECHARTS_THEME_NAME}
        option={option}
        notMerge
        lazyUpdate
        opts={{ renderer: 'svg' }}
        onEvents={onEvents}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
