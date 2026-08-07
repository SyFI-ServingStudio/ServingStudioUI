/**
 * The route out of §03, to the timing prediction that produced its modelled
 * stack.
 *
 * Which prediction that is comes from the alignment descriptor, not from here:
 * a bundle holds several `timing_predict*` directories once its capture has
 * been re-analysed, and only the analysis manifest records which of them these
 * numbers were read out of. This module is left with the addressing.
 */

/** Address a prediction the way every other producer of one does: workspace,
 * resource id, and the optimality mode the prediction page reads back out of
 * the URL. */
export function predictionHref(workspaceId: string, predictionId: string): string {
  const query = new URLSearchParams({
    workspace: workspaceId,
    prediction: predictionId,
    optimalityMode: 'unlocked',
  });
  return `#/prediction?${query.toString()}`;
}
