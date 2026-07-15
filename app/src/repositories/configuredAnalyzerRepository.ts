import type { AnalyzerRepository } from './AnalyzerRepository';
import { HttpAnalyzerRepository } from './HttpAnalyzerRepository';
import { bundledArtifactAnalyzerRepository } from './artifact/bundledAnalyzerArtifacts';

interface AnalyzerRepositoryEnvironment {
  mode: string;
  apiBaseUrl?: string;
}

/** Production builds opt into HTTP with VITE_ANALYZER_API_BASE. The dedicated
 * `live` Vite mode uses the same-origin `/api/v1/` proxy; ordinary dev/test
 * remains a deterministic checked-in artifact experience. */
export function createConfiguredAnalyzerRepository({
  mode,
  apiBaseUrl,
}: AnalyzerRepositoryEnvironment): AnalyzerRepository {
  const configuredBase = apiBaseUrl?.trim();
  const liveBase = configuredBase || (mode === 'live' ? '/api/v1/' : undefined);
  return liveBase === undefined
    ? bundledArtifactAnalyzerRepository
    : new HttpAnalyzerRepository({ apiBaseUrl: liveBase });
}

export const configuredAnalyzerRepository = createConfiguredAnalyzerRepository({
  mode: import.meta.env.MODE,
  apiBaseUrl: import.meta.env.VITE_ANALYZER_API_BASE,
});
