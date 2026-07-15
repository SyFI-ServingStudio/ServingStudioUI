import type {
  EChartsOption,
  GridComponentOption,
  TooltipComponentOption,
  YAXisComponentOption,
} from 'echarts';

import { tokens } from '../theme';

export interface ChartTheme {
  font: string;
  text: string;
  sub: string;
  axis: string;
  split: string;
  bg: string;
  tip: string;
  palette: string[];
}

export const CHART_THEME: ChartTheme = {
  font: tokens.body,
  text: tokens.ink,
  sub: tokens.sub,
  axis: '#d9cfbb',
  split: 'rgba(120,110,90,.15)',
  bg: tokens.tile,
  tip: 'rgba(42,38,34,.94)',
  palette: [tokens.teal, tokens.terra, tokens.gold, tokens.olive, tokens.violet],
};

/** The sole named ECharts theme. Runtime registration and every wrapper use
 * this name, so chart defaults cannot silently diverge between call sites. */
export const ECHARTS_THEME_NAME = 'vibesim-warm-paper';

export const ECHARTS_THEME = {
  color: CHART_THEME.palette,
  backgroundColor: 'transparent',
  textStyle: { color: CHART_THEME.text, fontFamily: CHART_THEME.font },
  legend: { textStyle: { color: CHART_THEME.sub, fontFamily: CHART_THEME.font } },
  tooltip: {
    renderMode: 'richText',
    backgroundColor: CHART_THEME.tip,
    borderWidth: 0,
    textStyle: { color: '#fff', fontFamily: CHART_THEME.font, fontSize: 12 },
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: CHART_THEME.axis } },
    axisLabel: { color: CHART_THEME.sub },
    splitLine: { lineStyle: { color: CHART_THEME.split, type: 'dashed' } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: CHART_THEME.axis } },
    axisLabel: { color: CHART_THEME.sub },
    splitLine: { lineStyle: { color: CHART_THEME.split, type: 'dashed' } },
  },
  logAxis: {
    axisLine: { lineStyle: { color: CHART_THEME.axis } },
    axisLabel: { color: CHART_THEME.sub },
    splitLine: { lineStyle: { color: CHART_THEME.split, type: 'dashed' } },
  },
};

const CHART_TEXT_REPLACEMENTS: Readonly<Record<string, string>> = {
  '&': '＆',
  '<': '＜',
  '>': '＞',
  '{': '｛',
  '}': '｝',
};

/** External analyzer identities are plain chart labels, never markup. Besides
 * HTML delimiters, braces are neutralized because zrender interprets
 * `{style|text}` in rich-text strings. Control characters cannot create
 * additional tooltip rows. */
export function safeChartText(value: unknown): string {
  return Array.from(String(value), (character) => {
    const replacement = CHART_TEXT_REPLACEMENTS[character];
    if (replacement) return replacement;
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character;
  }).join('');
}

/** Format custom tooltip content as canvas text. The final normalization is
 * deliberate even when a caller already sanitized individual identities. */
export function tooltipLines(lines: readonly unknown[]): string {
  return lines.map(safeChartText).join('\n');
}

export function richTextTooltip(
  theme: ChartTheme,
  trigger: NonNullable<TooltipComponentOption['trigger']>,
  overrides: TooltipComponentOption = {},
): TooltipComponentOption {
  return {
    backgroundColor: theme.tip,
    borderWidth: 0,
    ...overrides,
    trigger,
    // Keep this after overrides: no option builder may re-enable HTML mode.
    renderMode: 'richText',
    textStyle: {
      color: '#fff',
      fontFamily: theme.font,
      fontSize: 12,
      ...overrides.textStyle,
    },
  };
}

export function chartGrid(overrides: GridComponentOption = {}): GridComponentOption {
  return { left: 46, right: 16, top: 30, bottom: 30, ...overrides };
}

export function chartAxisLine(theme: ChartTheme) {
  return { lineStyle: { color: theme.axis } };
}

export function chartValueAxis(theme: ChartTheme): YAXisComponentOption {
  return {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: theme.sub, fontSize: 11 },
    splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
  };
}

/** Vertical marker shared by all continuous time-axis charts. */
export function cursorMarker(cursorSeconds: number) {
  return {
    type: 'line' as const,
    data: [] as number[][],
    silent: true,
    showSymbol: false,
    animation: false,
    markLine: {
      silent: true,
      symbol: ['none', 'none'] as [string, string],
      lineStyle: { color: tokens.terra, width: 1.5, opacity: 0.85 },
      label: { formatter: 'iter', color: tokens.terra, fontSize: 9, position: 'start' as const },
      data: [{ xAxis: +cursorSeconds.toFixed(2) }],
    },
  };
}

export function baseChartOption(theme: ChartTheme): EChartsOption {
  return {
    textStyle: { fontFamily: theme.font, color: theme.text },
    grid: chartGrid(),
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: theme.sub, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8,
    },
    tooltip: richTextTooltip(theme, 'axis'),
    xAxis: {
      type: 'value',
      axisLine: chartAxisLine(theme),
      axisLabel: { color: theme.sub, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: chartValueAxis(theme),
  };
}
