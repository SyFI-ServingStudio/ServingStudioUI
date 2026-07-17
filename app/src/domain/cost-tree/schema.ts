import { z, type ZodIssue } from 'zod';

import { invalidCostTree, type ExactLeafStats, type JsonValue, type RawCostNode } from './types';

type ParsedRawCostNode =
  | {
      kind: 'leaf';
      slot: {
        name: string;
        kind: string;
        kernel_config: Record<string, JsonValue>;
        backend: string | null;
      };
      base: number;
      stats: ExactLeafStats;
    }
  | { kind: 'sum'; label?: string; children: ParsedRawCostNode[] }
  | { kind: 'max'; label?: string; overlap: number; children: ParsedRawCostNode[] }
  | { kind: 'scale'; label?: string; n: number; children: ParsedRawCostNode[] };

const finiteNonNegativeSchema = z
  .number({
    invalid_type_error: 'expected a finite non-negative number',
    required_error: 'expected a finite non-negative number',
  })
  .finite('expected a finite non-negative number')
  .nonnegative('expected a finite non-negative number');
const overlapSchema = z
  .number({
    invalid_type_error: 'expected a finite overlap number',
    required_error: 'expected a finite overlap number',
  })
  .finite('expected a finite overlap number')
  .positive('expected a finite positive overlap number');
const uint32Schema = z
  .number({
    invalid_type_error: 'expected an unsigned 32-bit integer',
    required_error: 'expected an unsigned 32-bit integer',
  })
  .int('expected an unsigned 32-bit integer')
  .min(0, 'expected an unsigned 32-bit integer')
  .max(0xffff_ffff, 'expected an unsigned 32-bit integer');
const nonEmptyStringSchema = z.string().min(1, 'expected a non-empty string');
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);
const slotSchema = z
  .object({
    name: nonEmptyStringSchema,
    kind: nonEmptyStringSchema,
    kernel_config: z.record(jsonValueSchema),
    backend: z.string().nullable(),
  })
  .strict();
const nullableFiniteNonNegative = finiteNonNegativeSchema.nullable();
const exactLeafStatsSchema = z
  .object({
    input: jsonValueSchema,
    flops: nullableFiniteNonNegative,
    bytes: nullableFiniteNonNegative,
    tflops: nullableFiniteNonNegative,
    gbps: nullableFiniteNonNegative,
  })
  .strict();

// Recursive transport validation is deliberately kept out of the annotation
// engine. Zod owns exact fields/cardinality; the mapper below restores tuple
// types and runtime immutability after parsing.
const parsedRawCostNodeSchema: z.ZodType<ParsedRawCostNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('leaf'),
        slot: slotSchema,
        base: finiteNonNegativeSchema,
        stats: exactLeafStatsSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('sum'),
        label: z.string().optional(),
        children: z.array(parsedRawCostNodeSchema).min(1, 'sum requires at least one child'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('max'),
        label: z.string().optional(),
        overlap: overlapSchema,
        children: z.array(parsedRawCostNodeSchema).min(1, 'max requires at least one child'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('scale'),
        label: z.string().optional(),
        n: uint32Schema,
        children: z.array(parsedRawCostNodeSchema).length(1, 'scale requires exactly one child'),
      })
      .strict(),
  ]),
);

function assertAcyclic(input: unknown, path: string, ancestors: Set<object>): void {
  if (typeof input !== 'object' || input === null) return;
  if (ancestors.has(input)) invalidCostTree(path, 'cyclic node references are not supported');
  ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      input.forEach((value, index) => assertAcyclic(value, `${path}.${index}`, ancestors));
      return;
    }
    if ('children' in input) assertAcyclic(input.children, `${path}.children`, ancestors);
  } finally {
    ancestors.delete(input);
  }
}

function issuePath(issue: ZodIssue): string {
  return issue.path.reduce<string>((path, segment) => `${path}.${String(segment)}`, '$');
}

function issueMessage(issue: ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    return `unexpected field${issue.keys.length === 1 ? '' : 's'} ${issue.keys.join(', ')}`;
  }
  return issue.message;
}

function immutableRawNode(parsed: ParsedRawCostNode): RawCostNode {
  switch (parsed.kind) {
    case 'leaf':
      return Object.freeze({
        kind: 'leaf',
        slot: Object.freeze({
          name: parsed.slot.name,
          kind: parsed.slot.kind,
          kernel_config: freezeJson(parsed.slot.kernel_config) as Readonly<
            Record<string, JsonValue>
          >,
          backend: parsed.slot.backend,
        }),
        base: parsed.base,
        stats: Object.freeze({ ...parsed.stats, input: freezeJson(parsed.stats.input) }),
      });
    case 'sum': {
      const [first, ...rest] = parsed.children;
      if (first === undefined) invalidCostTree('$.children', 'validated Sum has no child');
      const children: [RawCostNode, ...RawCostNode[]] = [
        immutableRawNode(first),
        ...rest.map(immutableRawNode),
      ];
      return Object.freeze({
        kind: 'sum',
        ...(parsed.label === undefined ? {} : { label: parsed.label }),
        children: Object.freeze(children),
      });
    }
    case 'max': {
      const [first, ...rest] = parsed.children;
      if (first === undefined) invalidCostTree('$.children', 'validated Max has no child');
      const children: [RawCostNode, ...RawCostNode[]] = [
        immutableRawNode(first),
        ...rest.map(immutableRawNode),
      ];
      return Object.freeze({
        kind: 'max',
        ...(parsed.label === undefined ? {} : { label: parsed.label }),
        overlap: parsed.overlap,
        children: Object.freeze(children),
      });
    }
    case 'scale': {
      const [child] = parsed.children;
      if (child === undefined) invalidCostTree('$.children', 'validated Scale has no child');
      const children: [RawCostNode] = [immutableRawNode(child)];
      return Object.freeze({
        kind: 'scale',
        ...(parsed.label === undefined ? {} : { label: parsed.label }),
        n: parsed.n,
        children: Object.freeze(children),
      });
    }
  }
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeJson(child)])),
    );
  }
  return value;
}

export function parseRawCostNode(input: unknown): RawCostNode {
  assertAcyclic(input, '$', new Set<object>());
  const result = parsedRawCostNodeSchema.safeParse(input);
  if (!result.success) {
    const [firstIssue] = result.error.issues;
    if (firstIssue === undefined) invalidCostTree('$', 'unknown validation failure');
    invalidCostTree(issuePath(firstIssue), issueMessage(firstIssue));
  }
  return immutableRawNode(result.data);
}
