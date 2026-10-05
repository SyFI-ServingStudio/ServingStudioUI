import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { kernelKindsRef, seedArtifact } from '../artifacts';
import { createQueryClient } from '../app/queryClient';
import { TEST_KERNEL_KINDS } from './kernelKinds';

/**
 * A query client that already holds the kernel-kinds read, as the Analyzer
 * answers it, so a view that names or groups kernels renders without a
 * server: `render(ui, { wrapper: KernelKindsProvider })`.
 */
export function KernelKindsProvider({ children }: { readonly children: ReactNode }) {
  const [client] = useState(() => {
    const seeded = createQueryClient();
    seedArtifact(seeded, kernelKindsRef(), {
      status: 'ready',
      value: TEST_KERNEL_KINDS,
      schemaVersion: 1,
      revision: '',
    });
    return seeded;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
