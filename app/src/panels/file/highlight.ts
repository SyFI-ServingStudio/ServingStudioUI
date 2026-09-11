import type { SxProps, Theme } from '@mui/material/styles';

import { colors, tokens, withAlpha } from '../../ui/theme';

/**
 * Syntax highlighting for the file preview.
 *
 * highlight.js core plus one dynamically imported grammar per language, all
 * inside this route's lazy chunk — the entry bundle never pays for it. Grammars
 * are registered on first use and cached.
 */

/** Grammar per backend language id. Adding a language means adding a line here
 * and an extension in the backend's _LANGUAGE_BY_EXT. */
const GRAMMARS: Readonly<Record<string, () => Promise<{ default: unknown }>>> = {
  rust: () => import('highlight.js/lib/languages/rust'),
  python: () => import('highlight.js/lib/languages/python'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  // highlight.js ships no TOML grammar; its INI grammar covers TOML syntax.
  toml: () => import('highlight.js/lib/languages/ini'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  bash: () => import('highlight.js/lib/languages/bash'),
  sql: () => import('highlight.js/lib/languages/sql'),
  xml: () => import('highlight.js/lib/languages/xml'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
};

/**
 * Above this, tokenizing costs more than the colour is worth and the preview
 * would block on a single synchronous pass. Bigger files render as plain text.
 */
export const MAX_HIGHLIGHT_LINES = 8000;

export function canHighlight(language: string | null): boolean {
  return language !== null && language in GRAMMARS;
}

/**
 * Re-split highlight.js output into one HTML string per line.
 *
 * A grammar's span can cover a line break (a block comment, a multi-line
 * string), so the naive `.split('\n')` would tear the markup. Closing the open
 * spans at each break and re-opening them on the next line keeps every line a
 * standalone, balanced fragment — which is what a per-line grid needs.
 */
export function splitHighlightedLines(html: string): readonly string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  // highlight.js escapes `<`, `>` and `&` in the source text, so a raw `<`
  // here is always the start of one of its own spans.
  const token = /<span[^>]*>|<\/span>|\n|[^<\n]+/g;
  let match = token.exec(html);
  while (match !== null) {
    const value = match[0];
    if (value === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else if (value === '</span>') {
      open.pop();
      current += value;
    } else if (value.startsWith('<span')) {
      open.push(value);
      current += value;
    } else {
      current += value;
    }
    match = token.exec(html);
  }
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
}

/**
 * Highlight `text`, returning one HTML fragment per line, or null when the
 * language is unknown or the file is too large to be worth tokenizing.
 */
export async function highlightLines(
  text: string,
  language: string | null,
): Promise<readonly string[] | null> {
  const grammar = language === null ? undefined : GRAMMARS[language];
  if (language === null || grammar === undefined) return null;
  if (text.split('\n', MAX_HIGHLIGHT_LINES + 1).length > MAX_HIGHLIGHT_LINES) return null;
  const [{ default: hljs }, loaded] = await Promise.all([
    import('highlight.js/lib/core'),
    grammar(),
  ]);
  if (!hljs.getLanguage(language)) {
    hljs.registerLanguage(language, loaded.default as never);
  }
  return splitHighlightedLines(hljs.highlight(text, { language, ignoreIllegals: true }).value);
}

/**
 * Token colours in the app's own warm palette rather than a bundled
 * highlight.js theme, so a previewed file reads as part of the page.
 */
export const highlightSx: SxProps<Theme> = {
  '& .hljs-comment, & .hljs-quote': { color: colors.syntax.comment, fontStyle: 'italic' },
  '& .hljs-keyword, & .hljs-selector-tag, & .hljs-literal, & .hljs-doctag': {
    color: colors.syntax.keyword,
  },
  '& .hljs-string, & .hljs-regexp, & .hljs-addition': { color: colors.syntax.string },
  '& .hljs-number, & .hljs-symbol, & .hljs-bullet': { color: colors.syntax.number },
  '& .hljs-title, & .hljs-name, & .hljs-section, & .hljs-selector-id': {
    color: colors.syntax.title,
    fontWeight: 600,
  },
  '& .hljs-type, & .hljs-built_in, & .hljs-class .hljs-title': { color: colors.syntax.type },
  '& .hljs-attr, & .hljs-attribute, & .hljs-property, & .hljs-variable': {
    color: colors.syntax.variable,
  },
  '& .hljs-meta, & .hljs-params': { color: tokens.sub },
  '& .hljs-deletion': { color: tokens.terra, background: withAlpha(tokens.terra, 0.08) },
  '& .hljs-emphasis': { fontStyle: 'italic' },
  '& .hljs-strong': { fontWeight: 700 },
};
