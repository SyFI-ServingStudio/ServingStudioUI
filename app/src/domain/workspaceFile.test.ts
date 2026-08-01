import { describe, expect, it } from 'vitest';

import {
  classifyLinkTarget,
  detectPathToken,
  fileName,
  filePreviewHash,
  fileRefFromHash,
  pathAncestors,
} from './workspaceFile';

describe('classifyLinkTarget', () => {
  it('keeps a real URL external', () => {
    expect(classifyLinkTarget('https://vllm.ai/docs')).toEqual({
      kind: 'external',
      href: 'https://vllm.ai/docs',
    });
  });

  it('routes an in-app hash without opening a tab', () => {
    expect(classifyLinkTarget('#/run?workspace=w_main&run=r_1')).toEqual({
      kind: 'app',
      hash: '#/run?workspace=w_main&run=r_1',
    });
  });

  it('treats a relative path as a workspace file', () => {
    expect(classifyLinkTarget('logs/20260728_test/summary.json')).toEqual({
      kind: 'workspace-file',
      path: 'logs/20260728_test/summary.json',
      line: null,
    });
  });

  it('treats a container-absolute path as a workspace file, not a site URL', () => {
    expect(classifyLinkTarget('/workspace/logs/summary.json')).toEqual({
      kind: 'workspace-file',
      path: '/workspace/logs/summary.json',
      line: null,
    });
  });

  it('treats a host-absolute path as a workspace file', () => {
    expect(classifyLinkTarget('/m-coriander/main/logs/summary.json')).toEqual({
      kind: 'workspace-file',
      path: '/m-coriander/main/logs/summary.json',
      line: null,
    });
  });

  it('carries a trailing line number', () => {
    expect(classifyLinkTarget('simulator/src/main.rs:42')).toEqual({
      kind: 'workspace-file',
      path: 'simulator/src/main.rs',
      line: 42,
    });
  });

  it('refuses a traversing path', () => {
    expect(classifyLinkTarget('../../etc/passwd')).toEqual({ kind: 'plain' });
  });
});

describe('detectPathToken', () => {
  it.each([
    ['logs/20260728_test/summary.json', 'logs/20260728_test/summary.json', null],
    ['simulator/src/worker/mod.rs', 'simulator/src/worker/mod.rs', null],
    ['simulator/src/main.rs:42', 'simulator/src/main.rs', 42],
    ['simulator/src/main.rs:42:7', 'simulator/src/main.rs', 42],
    ['/workspace/logs/run.log', '/workspace/logs/run.log', null],
    ['logs/20260728_test/', 'logs/20260728_test/', null],
  ])('detects %s', (token, path, line) => {
    expect(detectPathToken(token)).toEqual({ kind: 'workspace-file', path, line });
  });

  it.each([
    ['s/old/new'], // a sed expression
    ['p50/p99'], // a metric pair
    ['TP/EP'], // a parallelism pair
    ['and/or'], // prose
    ['tokens/s'], // a unit
    ['summary.json'], // no directory separator: too ambiguous in prose
    ['logs/*.json'], // a glob
    ['cargo test --all'], // a command
    ['--log-dir=logs/x.json'], // a flag
    ['https://example.com/a.json'], // a URL, handled as a link instead
    ['logs/../etc/passwd.txt'], // traversal
    ['config/.env'], // a dotfile the backend refuses anyway
    ['logs/archive.tar.zst'], // an unlisted extension
  ])('leaves %s as prose', (token) => {
    expect(detectPathToken(token)).toEqual({ kind: 'plain' });
  });
});

describe('the file preview address', () => {
  it('round-trips a reference', () => {
    const ref = { workspaceId: 'w_main', path: 'logs/a b/summary.json', line: 12 };
    expect(fileRefFromHash(filePreviewHash(ref))).toEqual(ref);
  });

  it('round-trips a reference without a line', () => {
    const ref = { workspaceId: 'w_052a1b4d9fd0', path: 'README.md', line: null };
    expect(fileRefFromHash(filePreviewHash(ref))).toEqual(ref);
  });

  it.each([
    ['#/run?workspace=w_main&path=a.json'],
    ['#/file?workspace=bad-id&path=a.json'],
    ['#/file?workspace=w_main'],
    ['#/file?workspace=w_main&path=../secret'],
    ['#/file?workspace=w_main&path=a.json&line=0'],
  ])('rejects %s', (hash) => {
    expect(fileRefFromHash(hash)).toBeNull();
  });
});

describe('path presentation', () => {
  it('names a file and a directory', () => {
    expect(fileName('logs/run/summary.json')).toBe('summary.json');
    expect(fileName('logs/run/')).toBe('run');
  });

  it('lists ancestors outermost first, excluding the file', () => {
    expect(pathAncestors('logs/run/summary.json')).toEqual([
      { label: 'logs', path: 'logs' },
      { label: 'run', path: 'logs/run' },
    ]);
    expect(pathAncestors('summary.json')).toEqual([]);
  });
});
