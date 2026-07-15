import { describe, expect, it, vi } from 'vitest';

import {
  ArtifactModuleLoadError,
  ArtifactModuleMissingError,
  ArtifactModuleReader,
  ArtifactOutsideRunRootError,
  resolveAnalyzerV1ArtifactPath,
} from './ArtifactModuleReader';

const descriptorLocation = (artifactHref: string) => ({
  containingArtifactPath: 'runs/selected/run_descriptor.json',
  artifactHref,
  runRoot: 'runs/selected',
});

describe('resolveAnalyzerV1ArtifactPath', () => {
  it('resolves relative to the logical path containing the href', () => {
    expect(resolveAnalyzerV1ArtifactPath(descriptorLocation('payloads/slo.json'))).toBe(
      'runs/selected/payloads/slo.json',
    );
    expect(
      resolveAnalyzerV1ArtifactPath({
        containingArtifactPath: 'run_catalog.json',
        artifactHref: 'runs/selected/run_descriptor.json',
      }),
    ).toBe('runs/selected/run_descriptor.json');
  });

  it.each(['payloads/slo.json?revision=abc', 'payloads/slo.json#cdf', 'payloads/slo.json?q=1#x'])(
    'uses only the URL path for exact module lookup: %s',
    (artifactHref) => {
      expect(resolveAnalyzerV1ArtifactPath(descriptorLocation(artifactHref))).toBe(
        'runs/selected/payloads/slo.json',
      );
    },
  );

  it.each([
    'https://example.test/payload.json',
    '//example.test/payload.json',
    '/payload.json',
    '../payload.json',
    'payloads/../payload.json',
    'payloads/%2e%2e/payload.json',
    'payloads/%252e%252e/payload.json',
    'payloads\\payload.json',
    'payloads//payload.json',
  ])('rejects an unsafe analyzer-v1 href: %s', (artifactHref) => {
    expect(() => resolveAnalyzerV1ArtifactPath(descriptorLocation(artifactHref))).toThrow();
  });

  it('rejects a resolved path outside the already-selected run root', () => {
    expect(() =>
      resolveAnalyzerV1ArtifactPath({
        containingArtifactPath: 'runs/other/run_descriptor.json',
        artifactHref: 'summary.json',
        runRoot: 'runs/selected',
      }),
    ).toThrowError(ArtifactOutsideRunRootError);
  });
});

describe('ArtifactModuleReader', () => {
  it('does not invoke a module loader until its exact logical path is read', async () => {
    const summary = { total_tok_s: 42 };
    const loader = vi.fn(async () => summary);
    const reader = new ArtifactModuleReader({ 'runs/selected/summary.json': loader });

    expect(loader).not.toHaveBeenCalled();
    await expect(reader.read('runs/selected/summary.json')).resolves.toBe(summary);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reads a validated href relative to its containing descriptor', async () => {
    const payload = { schema_version: 1 };
    const loader = vi.fn(async () => payload);
    const reader = new ArtifactModuleReader({ 'runs/selected/payloads/slo.json': loader });

    await expect(
      reader.readRelative(descriptorLocation('payloads/slo.json?revision=abc#cdf')),
    ).resolves.toBe(payload);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns a typed missing error for a path absent from the exact allowlist', async () => {
    const reader = new ArtifactModuleReader({
      'runs/selected/summary.json': async () => ({ ok: true }),
    });

    const error = await reader.read('runs/selected/SUMMARY.json').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ArtifactModuleMissingError);
    expect(error).toMatchObject({
      code: 'artifact_missing',
      logicalPath: 'runs/selected/SUMMARY.json',
    });
  });

  it('shares one successful promise across concurrent and later reads', async () => {
    let resolveModule: ((value: unknown) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveModule = resolve;
        }),
    );
    const reader = new ArtifactModuleReader({ 'runs/selected/summary.json': loader });

    const firstRead = reader.read('runs/selected/summary.json');
    const concurrentRead = reader.read('runs/selected/summary.json');
    expect(firstRead).toBe(concurrentRead);
    expect(loader).toHaveBeenCalledTimes(0);

    const summary = { total_tok_s: 42 };
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    resolveModule?.(summary);
    await expect(firstRead).resolves.toBe(summary);

    const cachedRead = reader.read('runs/selected/summary.json');
    expect(cachedRead).toBe(firstRead);
    await expect(cachedRead).resolves.toBe(summary);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('wraps a loader rejection and evicts it so a retry performs a new load', async () => {
    const originalFailure = new Error('fixture chunk unavailable');
    const summary = { total_tok_s: 42 };
    let attempt = 0;
    const loader = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw originalFailure;
      return summary;
    });
    const reader = new ArtifactModuleReader({ 'runs/selected/summary.json': loader });

    const firstError = await reader
      .read('runs/selected/summary.json')
      .catch((cause: unknown) => cause);
    expect(firstError).toBeInstanceOf(ArtifactModuleLoadError);
    expect(firstError).toMatchObject({
      code: 'artifact_load_failed',
      logicalPath: 'runs/selected/summary.json',
      cause: originalFailure,
    });

    await expect(reader.read('runs/selected/summary.json')).resolves.toBe(summary);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
