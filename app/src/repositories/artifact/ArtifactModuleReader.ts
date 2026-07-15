import { analyzerV1ArtifactHrefSchema } from '../../contracts/analyzer/v1/artifactHref';

export type ArtifactModuleLoader = () => Promise<unknown>;
export type ArtifactModuleMap = Readonly<Record<string, ArtifactModuleLoader>>;

export type ArtifactModuleReaderErrorCode =
  'artifact_missing' | 'artifact_load_failed' | 'artifact_outside_run_root';

/** Stable repository error codes let callers distinguish a missing checked-in
 * artifact from a module-load failure without parsing user-facing text. */
export class ArtifactModuleReaderError extends Error {
  constructor(
    readonly code: ArtifactModuleReaderErrorCode,
    readonly logicalPath: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactModuleReaderError';
  }
}

export class ArtifactModuleMissingError extends ArtifactModuleReaderError {
  constructor(logicalPath: string) {
    super(
      'artifact_missing',
      logicalPath,
      `Analyzer artifact module is not present in the static allowlist: ${logicalPath}`,
    );
    this.name = 'ArtifactModuleMissingError';
  }
}

export class ArtifactModuleLoadError extends ArtifactModuleReaderError {
  readonly cause: unknown;

  constructor(logicalPath: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      'artifact_load_failed',
      logicalPath,
      `Could not load analyzer artifact module ${logicalPath}: ${detail}`,
    );
    this.name = 'ArtifactModuleLoadError';
    this.cause = cause;
  }
}

export class ArtifactOutsideRunRootError extends ArtifactModuleReaderError {
  readonly runRoot: string;

  constructor(logicalPath: string, runRoot: string) {
    super(
      'artifact_outside_run_root',
      logicalPath,
      `Analyzer artifact ${logicalPath} is outside the selected run root ${runRoot}.`,
    );
    this.name = 'ArtifactOutsideRunRootError';
    this.runRoot = runRoot;
  }
}

export interface RelativeArtifactLocation {
  /** Logical path of the catalog or descriptor that contains `artifactHref`. */
  containingArtifactPath: string;
  /** Analyzer-v1 same-origin relative reference from the containing artifact. */
  artifactHref: string;
  /** Trusted logical directory of the already-selected opaque run. */
  runRoot?: string;
}

function validateLogicalPath(logicalPath: string): string {
  analyzerV1ArtifactHrefSchema.parse(logicalPath);
  if (logicalPath.includes('?') || logicalPath.includes('#')) {
    throw new Error(`Logical artifact paths cannot contain a query or fragment: ${logicalPath}`);
  }
  return logicalPath;
}

function pathPart(artifactHref: string): string {
  return artifactHref.split(/[?#]/, 1)[0] ?? '';
}

function isWithinRunRoot(logicalPath: string, runRoot: string): boolean {
  return logicalPath === runRoot || logicalPath.startsWith(`${runRoot}/`);
}

/** Resolve exactly as a relative URL reference to the artifact containing the
 * href. No normalization or decoding is needed because the shared analyzer-v1
 * schema rejects every path segment that could traverse or change origin. */
export function resolveAnalyzerV1ArtifactPath({
  containingArtifactPath,
  artifactHref,
  runRoot,
}: RelativeArtifactLocation): string {
  const containingPath = validateLogicalPath(containingArtifactPath);
  analyzerV1ArtifactHrefSchema.parse(artifactHref);

  const containingDirectoryEnd = containingPath.lastIndexOf('/') + 1;
  const containingDirectory = containingPath.slice(0, containingDirectoryEnd);
  const resolvedPath = `${containingDirectory}${pathPart(artifactHref)}`;

  if (runRoot !== undefined) {
    const validatedRunRoot = validateLogicalPath(runRoot);
    if (!isWithinRunRoot(resolvedPath, validatedRunRoot)) {
      throw new ArtifactOutsideRunRootError(resolvedPath, validatedRunRoot);
    }
  }

  return resolvedPath;
}

/** Read only modules supplied by a build-time allowlist. Successful module
 * promises stay cached because a static export is immutable; a rejected promise
 * is evicted so React Query or an explicit retry performs a real second load. */
export class ArtifactModuleReader {
  private readonly moduleLoaders: ReadonlyMap<string, ArtifactModuleLoader>;
  private readonly modulePromises = new Map<string, Promise<unknown>>();

  constructor(moduleLoaders: ArtifactModuleMap) {
    this.moduleLoaders = new Map(
      Object.entries(moduleLoaders).map(([logicalPath, loader]) => [
        validateLogicalPath(logicalPath),
        loader,
      ]),
    );
  }

  read(logicalPath: string): Promise<unknown> {
    const validatedPath = validateLogicalPath(logicalPath);
    const cachedPromise = this.modulePromises.get(validatedPath);
    if (cachedPromise !== undefined) return cachedPromise;

    const loader = this.moduleLoaders.get(validatedPath);
    if (loader === undefined) return Promise.reject(new ArtifactModuleMissingError(validatedPath));

    const modulePromise = Promise.resolve()
      .then(loader)
      .catch((cause: unknown) => {
        if (this.modulePromises.get(validatedPath) === modulePromise) {
          this.modulePromises.delete(validatedPath);
        }
        throw new ArtifactModuleLoadError(validatedPath, cause);
      });
    this.modulePromises.set(validatedPath, modulePromise);
    return modulePromise;
  }

  readRelative(location: RelativeArtifactLocation): Promise<unknown> {
    return this.read(resolveAnalyzerV1ArtifactPath(location));
  }
}
