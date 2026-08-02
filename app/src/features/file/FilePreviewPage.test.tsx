import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FilePreviewPage from './FilePreviewPage';

interface StubbedFile {
  meta: Record<string, unknown>;
  body?: string;
  entries?: readonly Record<string, unknown>[];
  status?: number;
  detail?: string;
}

function stubBackend(file: StubbedFile) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (file.status) {
        return new Response(JSON.stringify({ detail: file.detail ?? 'denied' }), {
          status: file.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/api/file/meta')) {
        return new Response(JSON.stringify(file.meta), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/api/file/list')) {
        return new Response(JSON.stringify({ files: file.entries ?? [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(file.body ?? '', {
        status: 200,
        headers: { 'X-File-Truncated': '0', 'X-File-Total-Bytes': String(file.body?.length ?? 0) },
      });
    }),
  );
}

const textMeta = {
  workspace_id: 'w_main',
  path: 'logs/summary.json',
  name: 'summary.json',
  size: 42,
  mtime: 0,
  is_dir: false,
  preview_kind: 'text',
  language: 'json',
  preview_byte_limit: 5_242_880,
};

afterEach(() => vi.unstubAllGlobals());

describe('FilePreviewPage', () => {
  it('numbers the lines of a text file and marks the referenced one', async () => {
    // A .log rather than the JSON default, so this stays a test about the text
    // renderer and not about which structured view a file qualifies for.
    stubBackend({
      meta: { ...textMeta, path: 'logs/run.log', name: 'run.log', language: null },
      body: 'alpha\nbeta\ngamma\n',
    });

    render(<FilePreviewPage fileRef={{ workspaceId: 'w_main', path: 'logs/run.log', line: 2 }} />);

    const body = await screen.findByLabelText('File contents');
    expect(body).toHaveTextContent('alpha');
    expect(body).toHaveTextContent('gamma');
    // Three content lines, not four: the trailing newline is a terminator.
    expect(body.querySelectorAll('[data-line]')).toHaveLength(3);
    expect(screen.getByText('text · 42 B')).toBeInTheDocument();
  });

  it('offers a download instead of a preview for a binary artifact', async () => {
    stubBackend({
      meta: {
        ...textMeta,
        path: 'logs/worker_cost.parquet',
        name: 'worker_cost.parquet',
        size: 2048,
        preview_kind: 'binary',
        language: null,
      },
    });

    render(
      <FilePreviewPage
        fileRef={{ workspaceId: 'w_main', path: 'logs/worker_cost.parquet', line: null }}
      />,
    );

    expect(await screen.findByText(/binary artifact/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/file?path=logs%2Fworker_cost.parquet&workspace_id=w_main',
    );
  });

  it('browses a directory one level at a time', async () => {
    stubBackend({
      meta: { ...textMeta, path: 'logs', name: 'logs', is_dir: true, preview_kind: 'directory' },
      entries: [
        { path: 'logs/run', name: 'run', size: 0, mtime: 0, is_dir: true },
        {
          path: 'logs/summary.json',
          name: 'summary.json',
          size: 42,
          mtime: 0,
          is_dir: false,
          preview_kind: 'text',
        },
      ],
    });

    render(<FilePreviewPage fileRef={{ workspaceId: 'w_main', path: 'logs', line: null }} />);

    expect(await screen.findByRole('button', { name: /run\// })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /summary\.json/ })).toBeInTheDocument();
  });

  it('explains a refusal rather than showing an empty pane', async () => {
    stubBackend({ meta: textMeta, status: 403, detail: 'path looks like a credential file' });

    render(<FilePreviewPage fileRef={{ workspaceId: 'w_main', path: '.env', line: null }} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('path looks like a credential file');
  });

  it('names the missing file when a reference has gone stale', async () => {
    stubBackend({ meta: textMeta, status: 404, detail: 'logs/gone.json' });

    render(
      <FilePreviewPage fileRef={{ workspaceId: 'w_main', path: 'logs/gone.json', line: null }} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No such file');
  });
});

describe('structured views', () => {
  it('opens JSON as a tree and switches back to source', async () => {
    stubBackend({ meta: textMeta, body: '{"total_tps": 4195, "workers": [{"id": "attn/0"}]}' });
    const user = userEvent.setup();

    render(
      <FilePreviewPage
        fileRef={{ workspaceId: 'w_main', path: 'logs/summary.json', line: null }}
      />,
    );

    expect(await screen.findByLabelText('JSON tree')).toBeInTheDocument();
    expect(screen.getByText('total_tps')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByLabelText('File contents')).toBeInTheDocument();
    expect(screen.queryByLabelText('JSON tree')).not.toBeInTheDocument();
  });

  it('says so plainly when a .json file does not parse', async () => {
    stubBackend({ meta: textMeta, body: '{not json' });

    render(
      <FilePreviewPage
        fileRef={{ workspaceId: 'w_main', path: 'logs/summary.json', line: null }}
      />,
    );

    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
  });

  it('opens a CSV as a table with its true row count', async () => {
    stubBackend({
      meta: {
        ...textMeta,
        path: 'logs/rows.csv',
        name: 'rows.csv',
        language: null,
      },
      body: 'worker,tps\nattn/0,120\nffn/0,240\n',
    });

    render(
      <FilePreviewPage fileRef={{ workspaceId: 'w_main', path: 'logs/rows.csv', line: null }} />,
    );

    const table = await screen.findByLabelText('File contents as a table');
    expect(within(table).getByText('worker')).toBeInTheDocument();
    expect(within(table).getByText('attn/0')).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 rows · 2 columns/)).toBeInTheDocument();
  });

  it('renders Markdown, with its relative links still openable', async () => {
    stubBackend({
      meta: { ...textMeta, path: 'docs/design.md', name: 'design.md', language: 'markdown' },
      body: '# Design\n\nSee [the summary](logs/summary.json).\n',
    });

    render(
      <FilePreviewPage fileRef={{ workspaceId: 'w_main', path: 'docs/design.md', line: null }} />,
    );

    expect(await screen.findByRole('heading', { name: 'Design' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'the summary' })).toBeInTheDocument();
  });

  it('leaves a plain log file with no structured toggle', async () => {
    stubBackend({
      meta: { ...textMeta, path: 'logs/run.log', name: 'run.log', language: null },
      body: 'started\n',
    });

    render(
      <FilePreviewPage fileRef={{ workspaceId: 'w_main', path: 'logs/run.log', line: null }} />,
    );

    expect(await screen.findByLabelText('File contents')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Source' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wrap' })).toBeInTheDocument();
  });
});
