import { describe, expect, it } from 'vitest';

import { HttpAnalyzerRepository } from './HttpAnalyzerRepository';
import { bundledArtifactAnalyzerRepository } from './artifact/bundledAnalyzerArtifacts';
import { createConfiguredAnalyzerRepository } from './configuredAnalyzerRepository';

describe('createConfiguredAnalyzerRepository', () => {
  it('keeps ordinary development and tests deterministic', () => {
    expect(createConfiguredAnalyzerRepository({ mode: 'development' })).toBe(
      bundledArtifactAnalyzerRepository,
    );
    expect(createConfiguredAnalyzerRepository({ mode: 'test' })).toBe(
      bundledArtifactAnalyzerRepository,
    );
  });

  it('selects the same-origin HTTP transport for live mode or an explicit base', () => {
    expect(createConfiguredAnalyzerRepository({ mode: 'live' })).toBeInstanceOf(
      HttpAnalyzerRepository,
    );
    expect(
      createConfiguredAnalyzerRepository({ mode: 'production', apiBaseUrl: '/custom/v1/' }),
    ).toBeInstanceOf(HttpAnalyzerRepository);
  });
});
