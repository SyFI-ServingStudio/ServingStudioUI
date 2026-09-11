import { describe, expect, it } from 'vitest';

import { analyzerV1ArtifactHrefSchema } from './artifactHref';

/**
 * The one address guard left in the protocol.
 *
 * Descriptors no longer carry URLs, so this schema now guards two things: the
 * opaque trace download a descriptor may still name, and every path the
 * repository derives before handing it to `HttpJsonClient`. That second use is
 * the reason the table below is worth keeping — a derived path is built from
 * server-issued identities, and this is where a hostile one stops.
 */
describe('analyzerV1ArtifactHrefSchema', () => {
  it.each([
    'runs/plain-opaque-id/descriptor',
    'runs/id/subjects/throughput/payload',
    'runs/id/workers/attn/0/subjects/operations/payload?offset=0&limit=50',
  ])('accepts the relative address %s', (href) => {
    expect(analyzerV1ArtifactHrefSchema.parse(href)).toBe(href);
  });

  it.each([
    ['absolute URL', 'https://example.test/runs/id/descriptor'],
    ['whitespace-prefixed absolute URL', ' https://example.test/runs/id/descriptor'],
    ['scheme-relative URL', '//example.test/runs/id/descriptor'],
    ['origin-relative URL', '/api/analyzer/v1/runs/id/descriptor'],
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
  ])('rejects an address containing a %s', (_caseName, href) => {
    expect(analyzerV1ArtifactHrefSchema.safeParse(href).success).toBe(false);
  });
});
