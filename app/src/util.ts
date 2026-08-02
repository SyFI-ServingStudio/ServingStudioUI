import type { Run } from './domain/run';

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

function compactNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  });
}

/** Shared engineering-unit formatter for kernel facts. Callers provide the
 * source unit's ordered display scales so cards and hover surfaces cannot
 * drift in rounding or threshold behavior. */
export function scaledQuantity(
  value: number | null,
  scales: readonly { divisor: number; unit: string }[],
): { display: string; exact?: string } {
  if (value === null) return { display: 'not recorded' };
  const scale = scales.find((candidate) => Math.abs(value) >= candidate.divisor) ?? scales.at(-1);
  if (scale === undefined) return { display: value.toLocaleString() };
  return {
    display: `${compactNumber(value / scale.divisor)} ${scale.unit}`,
    exact: value.toLocaleString(),
  };
}

export function shortName(r: Run): string {
  const modelFile = r.model.split('/').pop() ?? r.model;
  const modelStem = modelFile.replace(/\.json$/i, '').replace(/[_-]+/g, ' ');
  return `${modelStem} · ${r.deployment.toUpperCase()}`;
}
