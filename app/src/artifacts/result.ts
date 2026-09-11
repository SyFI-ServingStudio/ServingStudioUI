/**
 * What reading an artifact can produce.
 *
 * Six states, defined once and returned by every read. The current application
 * spells this out differently in each of 34 hooks and answers "is this
 * available?" with 18 `=== undefined` probes against 25 optional repository
 * methods; the distinction between *not requested yet*, *never generated*,
 * *generated but unreadable* and *readable by a newer build* is exactly what
 * those probes lose.
 *
 * The panel's job is then a single exhaustive switch, and adding a state is a
 * compile error everywhere it matters.
 */
export type ArtifactResult<T> =
  /** In flight, or not requested yet. */
  | { status: 'pending' }
  | { status: 'ready'; value: T; schemaVersion: number; revision: string }
  /** The Analyzer knows about it but will not serve it — wrong deployment, a
   * gate that does not apply to this result. */
  | { status: 'unavailable'; reason: string; code?: string }
  /** The analysis that would produce it was never run. Distinct from
   * `unavailable`: re-running the analysis would fix it. */
  | { status: 'not_generated'; reason?: string }
  /** It exists and could not be read: transport, HTTP status, or invalid JSON. */
  | { status: 'failed'; code: string; reason: string }
  /** It parsed, but against a schema version this build does not implement. */
  | {
      status: 'incompatible';
      reason: string;
      received?: number;
      /** Structured schema or semantic failures for diagnostics and tests. */
      issues?: readonly string[];
    };

export function isReady<T>(
  result: ArtifactResult<T>,
): result is Extract<ArtifactResult<T>, { status: 'ready' }> {
  return result.status === 'ready';
}

/** True while the answer is still unknown, so a panel can hold its layout
 * instead of flashing an empty state. */
export function isPending<T>(result: ArtifactResult<T>): boolean {
  return result.status === 'pending';
}
