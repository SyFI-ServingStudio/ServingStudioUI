import { DEFAULT_THEME, isThemeId, type ThemeId } from './palettes';

export const THEME_STORAGE_KEY = 'vibesim.ui.theme';

export function resolveThemeId(query: string | null, saved: string | null): ThemeId {
  return isThemeId(query) ? query : isThemeId(saved) ? saved : DEFAULT_THEME;
}

export function readThemeId(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
  return resolveThemeId(new URLSearchParams(window.location.search).get('theme'), saved);
}

/** Reinitialize module-level chart/canvas palettes along with the MUI theme.
 * The picker is only shown outside the conversation setup flow. */
export function selectTheme(id: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* URL remains a fallback. */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('theme', id);
  window.location.assign(url);
}
