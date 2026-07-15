import { ArtifactAnalyzerRepository } from '../ArtifactAnalyzerRepository';
import {
  ArtifactModuleReader,
  type ArtifactModuleLoader,
  type ArtifactModuleMap,
} from './ArtifactModuleReader';

const JSON_GLOB_PREFIX = '../../../../fixtures/analyzer-v1/';

// Keep the glob literal in this build-owned module. Vite turns every match into
// an independent lazy loader; neither catalog bootstrap nor the entry bundle
// imports all analyzer payload JSON eagerly.
const bundledJsonModules = import.meta.glob<unknown>('../../../../fixtures/analyzer-v1/**/*.json', {
  import: 'default',
});

function logicalArtifactModules(
  modules: Readonly<Record<string, ArtifactModuleLoader>>,
  prefix: string,
): ArtifactModuleMap {
  return Object.fromEntries(
    Object.entries(modules).map(([modulePath, loader]) => {
      if (!modulePath.startsWith(prefix)) {
        throw new Error(`Bundled analyzer module is outside the configured prefix: ${modulePath}`);
      }
      return [modulePath.slice(prefix.length), loader];
    }),
  );
}

export const bundledArtifactModuleReader = new ArtifactModuleReader(
  logicalArtifactModules(bundledJsonModules, JSON_GLOB_PREFIX),
);

export const bundledArtifactAnalyzerRepository = new ArtifactAnalyzerRepository(
  bundledArtifactModuleReader,
);
