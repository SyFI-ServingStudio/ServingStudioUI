/**
 * Why a read produced no value, said once for every panel.
 *
 * The four failing states are four different situations and call for four
 * different reactions: an Analyzer that does not serve the address is a fact
 * about the deployment, an analysis that was never run is something a person
 * can go and start, a shape disagreement is a bug in one of two builds, and a
 * failed request may simply be worth trying again. A panel that phrased these
 * itself would phrase them slightly differently from the panel beside it, and a
 * reader would have to work out whether the difference meant anything.
 *
 * A pure function rather than only a component, because some surfaces have one
 * line and not an alert — the run headline says "latencies unavailable ·
 * <reason>" in a caption — and the wording must not fork because the container
 * did.
 */
import type { ArtifactResult } from '../artifacts';

export type ReadSeverity = 'info' | 'warning' | 'error';

export interface ReadProblemNote {
  readonly severity: ReadSeverity;
  readonly message: string;
}

/**
 * @param what the subject of the sentence, in the reader's terms — "this run's
 * summary", not "the runSummary artifact".
 */
export function describeRead(
  what: string,
  result: ArtifactResult<unknown>,
): ReadProblemNote | null {
  switch (result.status) {
    case 'unavailable':
      return {
        severity: 'info',
        message: `${what} is not served by this Analyzer: ${result.reason}`,
      };
    case 'not_generated':
      return {
        severity: 'info',
        message: `${what} was never generated. Re-running the analysis for this result would produce it.`,
      };
    case 'incompatible':
      return {
        severity: 'warning',
        message: `${what} is written in a format this build does not read: ${result.reason}`,
      };
    case 'failed':
      return {
        severity: 'error',
        message: `${what} could not be read (${result.code}): ${result.reason}`,
      };
    case 'pending':
    case 'ready':
      return null;
  }
}
