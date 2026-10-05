/**
 * Each kernel kind's title and category, as the kind's DOC declares it
 * (`GET /api/analyzer/v1/kernel-kinds`, from `profiling.db.doc.kind_vocabulary`).
 *
 * The UI names a kernel and groups it into a family only from this read, so a
 * kind added to the simulator is named and grouped by its own DOC.
 */
import { z } from 'zod';

import type { KernelKinds } from '../ref';

export const KERNEL_KINDS_SCHEMA_VERSION = 1;

const nonEmpty = z.string().min(1);

const schema = z.object({
  schema_version: z.literal(KERNEL_KINDS_SCHEMA_VERSION),
  categories: z.array(nonEmpty),
  kinds: z.record(z.object({ title: nonEmpty, category: nonEmpty })),
});

export function parseKernelKinds(body: unknown): KernelKinds {
  const value = schema.parse(body);
  const categories = new Set(value.categories);
  for (const [kind, entry] of Object.entries(value.kinds)) {
    if (!categories.has(entry.category)) {
      throw new Error(`kinds.${kind}: category ${entry.category} is not one of the categories`);
    }
  }
  return { categories: value.categories, kinds: value.kinds };
}
