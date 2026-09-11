/**
 * Label shapes §04 needs. Nothing here formats a number — that is `format.ts`
 * — these only decide how much of an analyzer name a row has space to say.
 */

/** The operation without its scope prefix. `layer.` and `model.` are the two
 * scopes a capture uses, and inside a legend where every entry carries one they
 * are noise; the full name is what the lane's aria label still says. */
export function shortOperationName(operation: string): string {
  return operation.replace(/^layer\./, '').replace(/^model\./, '');
}

/** The two operations across a gap, as the analyzer named them. An unlabelled
 * kernel says so rather than being dropped: "unmapped → attention" is a
 * finding, and an edge printed with one side missing would read as an error. */
export function gapEdgeLabel(fromOperation: string | null, toOperation: string | null): string {
  const side = (operation: string | null) =>
    operation === null ? 'unmapped' : shortOperationName(operation);
  return `${side(fromOperation)} → ${side(toOperation)}`;
}
