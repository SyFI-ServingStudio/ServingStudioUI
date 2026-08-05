import { fmtMs, fmtPct } from '../../domain/cost-tree';
import { fmtInt } from '../../util';

/**
 * The page's only number formatters.
 *
 * `fmtMs` / `fmtPct` / `fmtInt` are the app's, re-exported so nothing in this
 * feature reaches for `toFixed` and quietly invents a second rounding rule for
 * milliseconds. The three additions below are the shapes alignment needs and
 * the rest of the app does not: a signed error, a signed delta, and a duty
 * multiplier, which is shown at four decimals because it is a constant a
 * reader may want to copy exactly rather than a quantity to compare by eye.
 *
 * Several of them accept `null`, because the analyzer reports a GPU cycle as
 * absent on the last iteration of a capture. Absent prints as an em dash; the
 * alternative — printing zero — would state a measurement this page does not
 * have.
 */

export { fmtMs, fmtPct, fmtInt };

const sign = (value: number): string => (value >= 0 ? '+' : '−');

/** A signed relative error. The magnitude goes through `fmtPct` so its
 * precision rule matches every other percentage in the app. */
export function fmtSignedPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—';
  return `${sign(pct)}${fmtPct(Math.abs(pct))}`;
}

export function fmtSignedMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  return `${sign(ms)}${fmtMs(Math.abs(ms))}`;
}

/** A millisecond quantity the analyzer may report as absent. */
export function fmtOptionalMs(ms: number | null): string {
  return ms === null ? '—' : fmtMs(ms);
}

/**
 * A percentage at the precision an alignment error is claimed to.
 *
 * `fmtPct` drops to whole percent above 9.95 because a share of a total does
 * not earn more digits. An alignment error does: +29.45 % and +29 % are
 * different statements about how wrong the model is, and the second one cannot
 * be checked against the analyzer's own report. The space before the sign
 * follows the same rule the reference rendering uses.
 */
export function fmtPctPrecise(pct: number | null, decimals = 2): string {
  if (pct === null || !Number.isFinite(pct)) return '—';
  return `${sign(pct)}${Math.abs(pct).toFixed(decimals)} %`;
}

/**
 * A bare magnitude at a caller-chosen precision.
 *
 * Unsigned, unitless, no thousands separator: a row that has to agree with the
 * analyzer's report digit for digit picks its own decimals, because the number
 * of digits is part of the claim. `fmtMs` and `fmtPct` remain the default for
 * anything read at a glance rather than checked against a report.
 */
export function fmtFixed(value: number | null, decimals: number): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(decimals);
}

/** Milliseconds at a caller-chosen precision, for the same reason. */
export function fmtMsFixed(ms: number | null, decimals: number): string {
  return ms === null || !Number.isFinite(ms) ? '—' : `${ms.toFixed(decimals)} ms`;
}

/**
 * An axis tick: more decimals the smaller the quantity, so one column of ticks
 * stays readable whether it counts milliseconds or percent. This is the ladder
 * the reference rendering uses for every axis on the page.
 */
export function fmtAxisTick(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return value.toFixed(0);
  if (magnitude >= 10) return value.toFixed(1);
  if (magnitude >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

/**
 * A latency in milliseconds, at three decimals below 100 ms and two above.
 *
 * The ladder is coarse on purpose: a 3,179 ms end-to-end and a 6.208 ms decode
 * step share one column of cards, and both have to stay readable without
 * either being rounded past the digit the analyzer's report agrees to.
 */
export function fmtLatencyMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  return ms.toFixed(ms > 100 ? 2 : 3);
}

/**
 * A figure axis tick: one digit coarser than `fmtAxisTick`, with thousands
 * grouped and an exact zero written as `0`.
 *
 * Two ladders, because two kinds of axis. `fmtAxisTick` labels a series plot
 * whose whole range may sit under 1; this one labels a distribution figure
 * whose ticks are request counts and milliseconds in the thousands, where a
 * trailing decimal is noise.
 */
export function fmtFigureTick(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (magnitude >= 10) return value.toFixed(0);
  if (magnitude >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

/** A count, grouped. The unit a scheduler-shape card counts in is not time. */
export function fmtRounded(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

/** A duty multiplier, at the precision the analyzer reports it. */
export function fmtMultiplier(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `×${value.toFixed(4)}`;
}

/** Nanoseconds, the unit the timeline shard speaks, shown on the millisecond
 * scale `fmtMs` switches at. */
export function fmtNanoseconds(nanoseconds: number): string {
  if (!Number.isFinite(nanoseconds)) return '—';
  return fmtMs(nanoseconds / 1e6);
}

/** A quantity whose unit the analyzer supplies. Milliseconds go through
 * `fmtMs` so latency reads the same here as on the run pages; anything else
 * keeps the analyzer's own unit string rather than being converted. */
export function fmtQuantity(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'ms') return fmtMs(value);
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`.trim();
}
