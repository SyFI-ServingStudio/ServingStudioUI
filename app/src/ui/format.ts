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

/** A compact timestamp label shared by catalog and conversation lists. */
export function conversationTimeLabel(updatedAt: string | number | null | undefined): string {
  if (updatedAt == null || updatedAt === '') return '';
  const numeric = typeof updatedAt === 'number' ? updatedAt : Number(updatedAt);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(updatedAt));
  if (Number.isNaN(parsed.getTime())) return '';
  const today = new Date();
  if (parsed.toDateString() === today.toDateString()) {
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
