import { useEffect } from 'react';

import { ANALYZER_NAVIGATION_RESULT_EVENT } from '../../domain/analyzerNavigation';

/** Complete citation navigation only after the Analyzer-backed card exists. */
export function useOfflineEvidenceNavigation(
  evidenceId: string | null,
  resourceReady: boolean,
): void {
  useEffect(() => {
    if (evidenceId === null) return;
    const href = window.location.hash;
    const frame = window.requestAnimationFrame(() => {
      const node = Array.from(
        document.querySelectorAll<HTMLElement>('[data-evidence-id]'),
      ).find((candidate) => candidate.dataset.evidenceId === `panel:${evidenceId}`);
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.dispatchEvent(
        new CustomEvent(ANALYZER_NAVIGATION_RESULT_EVENT, {
          detail: {
            href,
            status: node ? 'ok' : resourceReady ? 'not-found' : 'unavailable',
          },
        }),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [evidenceId, resourceReady]);
}
