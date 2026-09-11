import { z } from 'zod';

/**
 * The capability half of the analyzer protocol.
 *
 * A descriptor states which views of an artifact exist and never where they
 * live: addresses follow from the grammar
 * `{kind}/{id}[/{scope}]/subjects/{name}/{report|payload}`, so a descriptor
 * that carried URLs would be restating the grammar in data — a second source of
 * truth that can drift from the router.
 */

/** Views are a set. A repeat would be two declarations of one capability, and
 * an empty list would declare a ready artifact with nothing to read. */
export const analyzerV1ViewsSchema = z
  .array(z.enum(['report', 'payload']))
  .nonempty()
  .refine((views) => new Set(views).size === views.length, { message: 'must not repeat a view' });

export const analyzerV1CapabilitySchema = z.object({ views: analyzerV1ViewsSchema }).strict();
