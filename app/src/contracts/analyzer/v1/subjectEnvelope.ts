import { z } from 'zod';

import type { SubjectName, SubjectPayloadByName, SubjectResult } from '../../../domain/subject';
import {
  formatZodIssue,
  incompatiblePayload,
  sourceLogDirIssue,
  unsupportedV1Payload,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

/**
 * The three outcomes a payload decoder can reach. `SubjectResult`'s remaining
 * states (pending / not_generated / failed) describe the *fetch*, so a decoder
 * that already holds a concrete payload never produces them.
 */
export type AnalyzerV1PayloadDecodeResult<Name extends SubjectName> =
  | Extract<SubjectResult<Name>, { status: 'ready' }>
  | Extract<SubjectResult<Name>, { status: 'unavailable' }>
  | Extract<SubjectResult<Name>, { status: 'incompatible' }>;

/** Both envelope arms carry the source id, so it is checked before discriminating. */
interface SourcedWire {
  meta: { log_dir: string };
}

/** The unavailable arm additionally states why the analyzer produced no data. */
interface UnavailableWire {
  meta: { log_dir: string; available: false; reason: string };
}

export interface AnalyzerV1PayloadDecoderSpec<
  Name extends SubjectName,
  ReadyWire extends SourcedWire,
  Options extends AnalyzerV1PayloadDecodeOptions,
> {
  /** Domain-side key echoed on every result. */
  subject: Name;
  /** Analyzer-side subject id, quoted verbatim in operator-facing messages. */
  label: string;
  readySchema: z.ZodType<ReadyWire, z.ZodTypeDef, unknown>;
  unavailableSchema: z.ZodType<UnavailableWire, z.ZodTypeDef, unknown>;
  /** Cross-field checks a schema cannot state; an empty list means sound. */
  semanticIssues: (wire: ReadyWire, options: Options) => string[];
  toPayload: (wire: ReadyWire) => SubjectPayloadByName[Name];
  /**
   * Override how schema violations are rendered. Defaults to one line per zod
   * issue; subjects whose wire is a column store pre-summarize instead, because
   * a per-cell issue list for a long column is unreadable.
   */
  formatSchemaIssues?: (input: unknown, issues: readonly z.ZodIssue[]) => string[];
}

/**
 * Build the decoder for one analyzer-v1 subject payload.
 *
 * Every subject shares this decision order, and the order is load-bearing:
 *
 *  1. a non-1 `schema_version` is reported as such, never as a schema mismatch;
 *  2. the wire must parse as the ready *or* the unavailable arm;
 *  3. a payload from a different run is rejected before its contents are read,
 *     so a stale artifact can never be mistaken for the selected run — this is
 *     checked on both arms, since an unavailable payload is equally misleading;
 *  4. the unavailable arm short-circuits with the analyzer's own reason;
 *  5. only then do cross-field semantics run, and finally the domain mapping.
 *
 * Subjects differ solely in the schemas and the three callbacks. Keeping the
 * order here means a fix to it reaches every subject at once, rather than
 * needing the same edit repeated per contract file.
 */
export function defineAnalyzerV1PayloadDecoder<
  Name extends SubjectName,
  ReadyWire extends SourcedWire,
  Options extends AnalyzerV1PayloadDecodeOptions = AnalyzerV1PayloadDecodeOptions,
>(
  spec: AnalyzerV1PayloadDecoderSpec<Name, ReadyWire, Options>,
): (input: unknown, options?: Options) => AnalyzerV1PayloadDecodeResult<Name> {
  const { subject, label } = spec;
  const wireSchema = z.union([spec.readySchema, spec.unavailableSchema]);

  // `subject` is a generic `Name`, so each arm is built as the concrete result
  // shape and asserted once here: TS cannot see that `Name`'s payload type and
  // `spec.toPayload`'s return type are the same member of the mapped type.
  const result = (value: object): AnalyzerV1PayloadDecodeResult<Name> =>
    ({ subject, ...value }) as AnalyzerV1PayloadDecodeResult<Name>;

  return (input, options = {} as Options) => {
    const unsupported = unsupportedV1Payload(label, input);
    if (unsupported) return result(unsupported);

    const parsed = wireSchema.safeParse(input);
    if (!parsed.success) {
      const issues = spec.formatSchemaIssues
        ? spec.formatSchemaIssues(input, parsed.error.issues)
        : parsed.error.issues.map(formatZodIssue);
      return result(incompatiblePayload(label, issues, 1));
    }

    const wire = parsed.data;
    const sourceIssue = sourceLogDirIssue(wire.meta.log_dir, options);
    if (sourceIssue) return result(incompatiblePayload(label, [sourceIssue], 1));

    if ('available' in wire.meta && wire.meta.available === false) {
      return result({ status: 'unavailable', reason: wire.meta.reason });
    }

    const readyWire = wire as ReadyWire;
    const issues = spec.semanticIssues(readyWire, options);
    if (issues.length > 0) return result(incompatiblePayload(label, issues, 1));

    return result({
      status: 'ready',
      schemaVersion: 1,
      payload: spec.toPayload(readyWire),
    });
  };
}
