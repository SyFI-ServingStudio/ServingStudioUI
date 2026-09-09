import { readableTerminalColor } from '../../theme/colors';
/**
 * Terminal colour for previewed logs.
 *
 * Run logs are captured straight from a tty, so they carry SGR escapes: the
 * simulator's `tracing` output dims timestamps and colours the level. Rendered
 * as plain text those escapes are worse than useless — the browser swallows the
 * ESC byte and leaves `[2m` / `[32m` littered through every line.
 *
 * This turns them into per-line HTML, the same shape `highlightLines` returns,
 * so `CodeView` needs no new branch. Colours resolve to the app's dark palette so levels remain legible
 * alongside the surrounding interface.
 */

import { tokens, colors, activeTheme } from '../../theme';

/* eslint-disable no-control-regex -- matching control characters is the point */
const ESCAPE_SEQUENCE =
  /\u001b(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const HAS_ESCAPE = /\u001b[[\]]/;
/* eslint-enable no-control-regex */

/** Foreground 30-37, chosen to stay legible on the paper background. */
const BASIC_FOREGROUND = [
  tokens.ink,
  tokens.terra,
  tokens.olive,
  tokens.gold,
  tokens.sectionAnalysis,
  tokens.violet,
  tokens.teal,
  tokens.sub2,
] as const;

/** Foreground 90-97. Brighter terminal variants remain readable on dark surfaces. */
const BRIGHT_FOREGROUND = [
  tokens.sub,
  colors.redBright,
  colors.greenBright,
  colors.amberBright,
  colors.blueBright,
  colors.violetBright,
  colors.cyanBright,
  tokens.ink,
] as const;

/** Backgrounds 40-47 as tints; a saturated fill would bury the text. */
const BASIC_BACKGROUND = [
  tokens.hair,
  colors.redWash,
  colors.greenWash,
  colors.amberWash,
  colors.blueWash,
  colors.violetWash,
  colors.cyanWash,
  tokens.tile,
] as const;

interface AnsiState {
  foreground: string | null;
  background: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  inverse: boolean;
}

const DEFAULT_STATE: AnsiState = {
  foreground: null,
  background: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strike: false,
  inverse: false,
};

function readable(red: number, green: number, blue: number): string {
  return readableTerminalColor(red, green, blue, activeTheme.mode);
}

/** One of the 256 indexed colours, as a page-legible hex. */
function indexedColor(index: number, background: boolean): string {
  if (index < 8) return (background ? BASIC_BACKGROUND : BASIC_FOREGROUND)[index] ?? tokens.ink;
  if (index < 16) {
    return background
      ? (BASIC_BACKGROUND[index - 8] ?? tokens.tile)
      : (BRIGHT_FOREGROUND[index - 8] ?? tokens.ink);
  }
  if (index < 232) {
    const offset = index - 16;
    const step = (value: number): number => (value === 0 ? 0 : value * 40 + 55);
    return readable(
      step(Math.floor(offset / 36)),
      step(Math.floor(offset / 6) % 6),
      step(offset % 6),
    );
  }
  const grey = (index - 232) * 10 + 8;
  return readable(grey, grey, grey);
}

/**
 * Apply one SGR sequence's parameters.
 *
 * Extended colours (`38`/`48`) swallow their own arguments, so this walks the
 * list with an index rather than mapping over it.
 */
function applySgr(state: AnsiState, params: readonly number[]): AnsiState {
  const next = { ...state };
  for (let cursor = 0; cursor < params.length; cursor += 1) {
    const code = params[cursor] ?? 0;
    if (code === 0) {
      Object.assign(next, DEFAULT_STATE);
    } else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code === 29) next.strike = false;
    else if (code >= 30 && code <= 37) next.foreground = BASIC_FOREGROUND[code - 30] ?? null;
    else if (code === 39) next.foreground = null;
    else if (code >= 40 && code <= 47) next.background = BASIC_BACKGROUND[code - 40] ?? null;
    else if (code === 49) next.background = null;
    else if (code >= 90 && code <= 97) next.foreground = BRIGHT_FOREGROUND[code - 90] ?? null;
    else if (code >= 100 && code <= 107) next.background = BASIC_BACKGROUND[code - 100] ?? null;
    else if (code === 38 || code === 48) {
      const isBackground = code === 48;
      const mode = params[cursor + 1];
      if (mode === 5) {
        const value = indexedColor(params[cursor + 2] ?? 0, isBackground);
        if (isBackground) next.background = value;
        else next.foreground = value;
        cursor += 2;
      } else if (mode === 2) {
        const value = readable(
          params[cursor + 2] ?? 0,
          params[cursor + 3] ?? 0,
          params[cursor + 4] ?? 0,
        );
        if (isBackground) next.background = value;
        else next.foreground = value;
        cursor += 4;
      }
    }
  }
  return next;
}

/** The inline style for a state, or '' when nothing needs to be drawn. */
function styleFor(state: AnsiState): string {
  const foreground = state.inverse ? (state.background ?? tokens.paper) : state.foreground;
  const background = state.inverse ? (state.foreground ?? tokens.ink) : state.background;
  const declarations: string[] = [];
  if (foreground !== null) declarations.push(`color:${foreground}`);
  if (background !== null) declarations.push(`background:${background}`);
  if (state.bold) declarations.push('font-weight:700');
  // Dim is a fade in a terminal, and a fade is hue-independent — unlike picking
  // a second, lighter colour per palette entry.
  if (state.dim) declarations.push('opacity:.62');
  if (state.italic) declarations.push('font-style:italic');
  const lines: string[] = [];
  if (state.underline) lines.push('underline');
  if (state.strike) lines.push('line-through');
  if (lines.length > 0) declarations.push(`text-decoration:${lines.join(' ')}`);
  return declarations.join(';');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** True when `text` carries escape sequences worth interpreting. */
export function hasAnsi(text: string): boolean {
  return HAS_ESCAPE.test(text);
}

/** `text` with every escape sequence removed and nothing else changed. */
export function stripAnsi(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '');
}

/**
 * Render `text` as one balanced HTML fragment per line.
 *
 * Styling state survives a line break — a colour opened on one line and reset
 * three lines later is normal in a progress log — but the markup does not: each
 * line closes its own spans so a per-line grid can mount them independently.
 *
 * The returned line count matches `stripAnsi(text).split('\n')`, so gutter
 * numbers, `?line=` anchors and search hits all stay aligned.
 */
export function ansiLines(text: string): readonly string[] {
  const lines: string[] = [];
  let current = '';
  let state = DEFAULT_STATE;

  const append = (segment: string): void => {
    if (segment === '') return;
    const style = styleFor(state);
    current +=
      style === '' ? escapeHtml(segment) : `<span style="${style}">${escapeHtml(segment)}</span>`;
  };
  const appendWithBreaks = (segment: string): void => {
    const pieces = segment.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) {
        lines.push(current);
        current = '';
      }
      append(piece);
    });
  };

  ESCAPE_SEQUENCE.lastIndex = 0;
  let cursor = 0;
  let match = ESCAPE_SEQUENCE.exec(text);
  while (match !== null) {
    appendWithBreaks(text.slice(cursor, match.index));
    const sequence = match[0];
    if (sequence.startsWith('\u001b[') && sequence.endsWith('m')) {
      const body = sequence.slice(2, -1);
      const params = body
        .split(/[;:]/)
        .map((part) => (part === '' ? 0 : Number(part)))
        .filter((value) => Number.isFinite(value));
      state = applySgr(state, params.length === 0 ? [0] : params);
    }
    cursor = match.index + sequence.length;
    match = ESCAPE_SEQUENCE.exec(text);
  }
  appendWithBreaks(text.slice(cursor));
  lines.push(current);
  return lines;
}
