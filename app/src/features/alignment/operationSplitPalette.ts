import type { AlignmentMappedOperation } from '../../domain/alignment';
import { tokens } from '../../theme';

/**
 * Operation colours for §03, assigned by rotating through the shared panel in
 * mapping order.
 *
 * Both stacks of one cycle are read side by side, so an operation has to keep
 * one colour across the two lanes and the ribbons between them. The operation
 * label is only the lookup key: its spelling and semantic parts do not affect
 * the selected hue.
 */

const SHADE_STEP = 0.09;
const DARKEN_AMOUNT = 0.15;

interface Channels {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function channelsOf(color: string): Channels {
  const digits = color.replace('#', '');
  return {
    red: Number.parseInt(digits.slice(0, 2), 16),
    green: Number.parseInt(digits.slice(2, 4), 16),
    blue: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function mix(color: string, towards: string, amount: number): string {
  const from = channelsOf(color);
  const to = channelsOf(towards);
  const blend = (start: number, end: number): number =>
    Math.round(start + (end - start) * Math.min(1, Math.max(0, amount)));
  return `rgb(${blend(from.red, to.red)}, ${blend(from.green, to.green)}, ${blend(from.blue, to.blue)})`;
}

/** A shared colour at partial opacity, for a wash under something readable. */
export function withAlpha(color: string, alpha: number): string {
  const { red, green, blue } = channelsOf(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * One step of a family's lightness ladder.
 *
 * Step 0 is the family colour itself, so a family with a single operation
 * looks exactly as it does everywhere else in the app. One step below it is
 * darker and the rest climb towards paper, which keeps the first three steps
 * dark enough to carry the white segment labels the stacks draw on them.
 */
export function shadeOf(familyColor: string, step: number): string {
  if (step === 0) return familyColor;
  if (step < 0) return mix(familyColor, tokens.ink, DARKEN_AMOUNT * -step);
  return mix(familyColor, tokens.paper, SHADE_STEP * step);
}

export interface OperationPalette {
  /** A measured group or modelled slot the labeler tied to no operation. */
  readonly unmapped: string;
  readonly colorOf: (operation: string | null | undefined) => string;
}

/**
 * Assigns the next panel color to each new operation in source order. Repeated
 * labels reuse their first assignment, which keeps the measured/modelled pair
 * and every connector for that operation visually tied together.
 */
export function rotatingOperationColors(
  operations: readonly { readonly operation: string }[],
): Readonly<Record<string, string>> {
  const colors: Record<string, string> = {};
  const colorPanel = tokens.operationColorPanel;
  let nextColorIndex = 0;
  for (const entry of operations) {
    if (colors[entry.operation] !== undefined) continue;
    colors[entry.operation] = colorPanel[nextColorIndex % colorPanel.length];
    nextColorIndex += 1;
  }
  return colors;
}

/**
 * The capture's operations resolve through the rotating panel. Selecting a
 * different cycle never changes a registered operation's colour because the
 * palette is built from the capture mapping, not from the selected cycle.
 */
export function operationPalette(
  operations: readonly AlignmentMappedOperation[],
): OperationPalette {
  const colors = rotatingOperationColors(operations);
  const unmapped = tokens.sub2;
  return {
    unmapped,
    colorOf: (operation) =>
      operation === null || operation === undefined ? unmapped : (colors[operation] ?? unmapped),
  };
}

/** `layer.attention_post_norm` shown as `attention_post_norm`: the qualifier
 * repeats on nearly every row and the rail is narrow. */
export function shortOperationName(operation: string): string {
  const separator = operation.indexOf('.');
  return separator < 0 ? operation : operation.slice(separator + 1);
}
