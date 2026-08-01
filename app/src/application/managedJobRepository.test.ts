import { afterEach, describe, expect, it, vi } from 'vitest';

import { listManagedJobs } from './managedJobRepository';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('managed job repository', () => {
  it('decodes the Page 0 typed result catalog', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jobs: [
              {
                workspace_id: 'w_main',
                job_id: 'j_profile',
                conversation_id: 'c_profile',
                conversation_title: 'Kernel study',
                resource_id: 'jr_profile',
                analyzer_resource_id: 'kp_profile',
                job_kind: 'kernel_profile',
                status: 'ready',
                created_at: 1785513600,
                updated_at: 1785513601,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listManagedJobs()).resolves.toEqual([
      expect.objectContaining({
        workspaceId: 'w_main',
        resourceId: 'jr_profile',
        analyzerResourceId: 'kp_profile',
        jobKind: 'kernel_profile',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs');
  });
});
