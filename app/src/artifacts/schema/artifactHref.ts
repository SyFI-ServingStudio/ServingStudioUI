import { z } from 'zod';

const URI_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const ENCODED_PATH_ESCAPE = /%(?:25|2e|2f|5c)/i;

function hasRawUrlWhitespaceOrControl(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f);
  });
}

/** Analyzer hrefs are same-origin relative URL references, never filesystem
 * paths. Repositories resolve them only after selecting a trusted opaque run. */
export const analyzerV1ArtifactHrefSchema = z
  .string()
  .min(1)
  .superRefine((href, context) => {
    if (hasRawUrlWhitespaceOrControl(href)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not contain raw whitespace or control characters',
      });
    }
    if (URI_SCHEME.test(href)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must not be an absolute URL' });
    }
    if (href.startsWith('//')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not be a scheme-relative URL',
      });
    } else if (href.startsWith('/')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be relative to the containing artifact URL',
      });
    }
    if (href.includes('\\')) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must not contain a backslash' });
    }
    if (ENCODED_PATH_ESCAPE.test(href)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not contain an encoded percent, dot, slash, or backslash',
      });
    }

    const path = href.split(/[?#]/, 1)[0] ?? '';
    const segments = path.split('/');
    if (segments.some((segment) => segment.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not contain an empty path segment',
      });
    }
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not contain dot path segments',
      });
    }
  });
