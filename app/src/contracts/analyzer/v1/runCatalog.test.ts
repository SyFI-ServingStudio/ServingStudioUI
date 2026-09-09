import { describe, expect, it } from 'vitest';

import { parseAnalyzerV1RunCatalog } from './runCatalog';

interface WireRunOverrides {
  workspace_id?: string;
  run_id?: string;
  display_name?: string;
  descriptor_href?: string;
  lifecycle?: {
    simulation: 'not_started' | 'pending' | 'complete' | 'failed';
    analysis: 'not_started' | 'pending' | 'complete' | 'failed';
  };
  updated_at?: string;
}

function wireRun(overrides: WireRunOverrides = {}): Record<string, unknown> {
  return {
    workspace_id: overrides.workspace_id ?? 'w_main',
    run_id: overrides.run_id ?? 'plain-opaque-id',
    kind: 'simulation',
    display_name: overrides.display_name ?? '20260715_1_afd_ui_reanalysis',
    descriptor_href: overrides.descriptor_href ?? 'runs/plain-opaque-id/descriptor',
    lifecycle: overrides.lifecycle ?? { simulation: 'complete', analysis: 'complete' },
    updated_at: overrides.updated_at ?? '2026-07-15T05:11:53Z',
  };
}

function validWireCatalog(): Record<string, unknown> {
  return {
    protocol_version: 1,
    generated_at: '2026-07-15T05:12:00Z',
    runs: [wireRun()],
  };
}

describe('parseAnalyzerV1RunCatalog', () => {
  it('maps the strict snake-case contract and accepts a non-ULID opaque run id', () => {
    const catalog = parseAnalyzerV1RunCatalog(validWireCatalog());

    expect(catalog).toEqual({
      protocolVersion: 1,
      generatedAt: '2026-07-15T05:12:00Z',
      runs: [
        {
          workspaceId: 'w_main',
          runId: 'plain-opaque-id',
          kind: 'simulation',
          displayName: '20260715_1_afd_ui_reanalysis',
          descriptorHref: 'runs/plain-opaque-id/descriptor',
          lifecycle: { simulation: 'complete', analysis: 'complete' },
          updatedAt: '2026-07-15T05:11:53Z',
        },
      ],
    });
  });

  it('preserves server order instead of silently sorting during decode', () => {
    const wire = validWireCatalog();
    wire.runs = [
      wireRun({
        run_id: 'older-z',
        descriptor_href: 'runs/older-z/descriptor',
        updated_at: '2026-07-14T00:00:00Z',
      }),
      wireRun({
        run_id: 'newer-a',
        descriptor_href: 'runs/newer-a/descriptor',
        updated_at: '2026-07-15T00:00:00Z',
      }),
    ];

    expect(parseAnalyzerV1RunCatalog(wire).runs.map((run) => run.runId)).toEqual([
      'older-z',
      'newer-a',
    ]);
  });

  it('rejects duplicate opaque run ids at their later catalog position', () => {
    const wire = validWireCatalog();
    wire.runs = [wireRun(), wireRun({ descriptor_href: 'runs/duplicate/descriptor' })];

    expect(() => parseAnalyzerV1RunCatalog(wire)).toThrow(
      /runs\.1\.run_id: duplicate run_id plain-opaque-id/,
    );
  });

  it('rejects unsupported protocol versions', () => {
    const wire = validWireCatalog();
    wire.protocol_version = 2;

    expect(() => parseAnalyzerV1RunCatalog(wire)).toThrow(
      /protocol_version: Invalid literal value, expected 1/,
    );
  });

  it.each([
    ['absolute URL', 'https://example.test/runs/id/descriptor'],
    ['whitespace-prefixed absolute URL', ' https://example.test/runs/id/descriptor'],
    ['scheme-relative URL', '//example.test/runs/id/descriptor'],
    ['origin-relative URL', '/api/v1/runs/id/descriptor'],
    ['leading traversal', '../runs/id/descriptor'],
    ['nested traversal', 'runs/id/../secret'],
    ['literal current-directory segment', 'runs/./id/descriptor'],
    ['encoded traversal', 'runs/%2E%2E/secret'],
    ['double-encoded traversal', 'runs/%252E%252E/secret'],
    ['encoded slash', 'runs%2Fid/descriptor'],
    ['double-encoded slash', 'runs%252Fid/descriptor'],
    ['encoded backslash', 'runs/%5cid/descriptor'],
    ['backslash', 'runs\\id\\descriptor'],
    ['empty segment', 'runs//id/descriptor'],
  ])('rejects an unsafe descriptor href containing a %s', (_caseName, descriptorHref) => {
    const wire = validWireCatalog();
    wire.runs = [wireRun({ descriptor_href: descriptorHref })];

    expect(() => parseAnalyzerV1RunCatalog(wire)).toThrow(/runs\.0\.descriptor_href:/);
  });

  it('rejects protocol drift at nested object boundaries', () => {
    const wire = validWireCatalog();
    wire.runs = [
      {
        ...wireRun(),
        displayName: 'camelCase must not be accepted on the wire',
      },
    ];

    expect(() => parseAnalyzerV1RunCatalog(wire)).toThrow(/runs\.0: Unrecognized key/);
  });
});
