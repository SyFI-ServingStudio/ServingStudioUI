import type { EChartsOption } from 'echarts';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { memo, type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { echarts } from '../charts/echartsRuntime';
import { ECHARTS_THEME_NAME } from '../charts/platform';

/** Thin wrapper around echarts-for-react — fills its parent, keeps plot text
 * as SVG text, and replaces (not merges) options so scope changes redraw
 * cleanly. Analyzer chart payloads are bounded before reaching this layer; a
 * future canvas exception must therefore be justified by measured density. */
function EChart({
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
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReactEChartsCore>(null);
  const [hasRenderableSize, setHasRenderableSize] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') {
      setHasRenderableSize(true);
      return;
    }
    const revealChartWhenSized = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;
      setHasRenderableSize(true);
      return true;
    };
    if (revealChartWhenSized()) return;
    const observer = new ResizeObserver(() => {
      if (revealChartWhenSized()) observer.disconnect();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasRenderableSize) return;
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let visible = true;
    let resizePending = false;
    let resizeFrame: number | null = null;
    let stableFrameCount = 0;
    let renderedWidth = -1;
    let renderedHeight = -1;

    const resizeChartToContainer = () => {
      if (!visible) {
        resizePending = true;
        return false;
      }
      const chart = chartRef.current?.getEchartsInstance();
      if (!chart || chart.isDisposed()) return false;
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;
      chart.resize({
        width: bounds.width,
        height: bounds.height,
        silent: true,
        animation: { duration: 0 },
      });
      renderedWidth = bounds.width;
      renderedHeight = bounds.height;
      resizePending = false;
      return true;
    };

    const resizeOnAnimationFrame = () => {
      resizeFrame = null;
      if (!visible) {
        resizePending = true;
        return;
      }
      const bounds = container.getBoundingClientRect();
      const sizeChanged =
        Math.abs(bounds.width - renderedWidth) > 0.25 ||
        Math.abs(bounds.height - renderedHeight) > 0.25;
      if (resizePending || sizeChanged) {
        resizeChartToContainer();
        stableFrameCount = 0;
      } else {
        stableFrameCount += 1;
      }
      // A CSS layout transition may advance independently of ResizeObserver
      // delivery. Stay live until three consecutive frames report no change.
      if (stableFrameCount < 3) {
        resizeFrame = window.requestAnimationFrame(resizeOnAnimationFrame);
      }
    };

    const queueLiveResize = () => {
      resizePending = true;
      stableFrameCount = 0;
      if (resizeFrame === null) {
        resizeFrame = window.requestAnimationFrame(resizeOnAnimationFrame);
      }
    };

    // ResizeObserver starts a deterministic frame loop rather than owning the
    // draw itself; this prevents observer batching from desynchronizing a plot
    // from the card boundary during workspace width transitions.
    const observer = new ResizeObserver(queueLiveResize);
    const visibilityObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries[0]?.isIntersecting ?? true;
            if (visible && resizePending) queueLiveResize();
          });
    observer.observe(container);
    visibilityObserver?.observe(container);
    return () => {
      observer.disconnect();
      visibilityObserver?.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [hasRenderableSize]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ height: '100%', width: '100%', ...style }}
    >
      {hasRenderableSize ? (
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          theme={ECHARTS_THEME_NAME}
          option={option}
          notMerge
          lazyUpdate
          opts={{ renderer: 'svg' }}
          onEvents={onEvents}
          style={{ height: '100%', width: '100%' }}
        />
      ) : null}
    </div>
  );
}

/** A selected evidence shell must not ask ECharts to reconcile an unchanged
 * option merely because the surrounding card acquired a glow. */
export default memo(EChart);
