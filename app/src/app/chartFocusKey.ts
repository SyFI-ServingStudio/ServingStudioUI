import type { Location } from '../location';

/** The key a chart focus is kept under: it resets when the addressed result changes. */
export function chartFocusResetKey(location: Location | null): string | null {
  if (location === null) return null;
  if (location.view !== 'result') return location.view;
  const { kind, workspace, id, revision } = location.ref;
  return `result:${kind}:${workspace}:${id}:${revision ?? ''}`;
}
