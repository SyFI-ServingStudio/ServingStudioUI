import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The page's standing rules, enforced against its own source.
 *
 * The design study this page came from was policed by a script for one reason:
 * an alignment page is a page ABOUT a specific capture, and the easiest way to
 * make it read well is to write down what that capture happened to show. Those
 * sentences then survive into every other capture the page is opened on, as
 * confident, wrong prose.
 *
 * So: colours come from the shared tokens, formatting from the shared
 * formatters, drawing from the app's three idioms, and every sentence
 * explaining what a number MEANS comes from the analyzer, not from here.
 */

const FEATURE_DIR = join(import.meta.dirname, '.');

function featureSources(): readonly { name: string; text: string }[] {
  return readdirSync(FEATURE_DIR)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(join(FEATURE_DIR, name), 'utf8') }));
}

/** Terms that only make sense for the capture this page was designed against.
 * Any of them in the source means a finding got written into the product. */
const CAPTURE_SPECIFIC = [
  'llama',
  'tp4',
  'rate32',
  'h200',
  '1.329',
  '2,040',
  '2040 iteration',
  'nvjet',
  'vllm_iteration',
];

/** Verdicts. A page may show that the model overpredicts; it may not conclude
 * that it does, because the next capture decides that, not this source file. */
const VERDICT_PHRASES = [
  'the model overpredicts',
  'the model underpredicts',
  'this is the bug',
  'the culprit',
  'as expected',
  'unsurprisingly',
  'clearly shows',
  'proves that',
];

describe('alignment page discipline', () => {
  const sources = featureSources();

  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it('names no colour of its own, anywhere', () => {
    // Every scale the page needs beyond the shared ones — operation shades,
    // iteration types, host call classes, NVTX depth — is DERIVED from `tokens`
    // or `GROUP` in `wallClockPalette`, so there is no file left that may hold
    // a literal.
    for (const source of sources) {
      const hexColors = source.text.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      expect(hexColors, `${source.name} hard-codes a colour`).toEqual([]);
    }
  });

  it('formats no number of its own', () => {
    for (const source of sources) {
      if (source.name === 'format.ts') continue;
      expect(source.text.includes('toFixed'), `${source.name} formats a number itself`).toBe(false);
    }
  });

  it('draws with the app`s three idioms and adds no hand-written SVG', () => {
    for (const source of sources) {
      expect(source.text.includes('<svg'), `${source.name} hand-writes SVG`).toBe(false);
    }
  });

  it('carries no term specific to the capture it was designed against', () => {
    for (const source of sources) {
      const lowered = source.text.toLowerCase();
      for (const term of CAPTURE_SPECIFIC) {
        expect(lowered.includes(term), `${source.name} mentions "${term}"`).toBe(false);
      }
    }
  });

  it('states no verdict about what a capture shows', () => {
    for (const source of sources) {
      const lowered = source.text.toLowerCase();
      for (const phrase of VERDICT_PHRASES) {
        expect(lowered.includes(phrase), `${source.name} concludes "${phrase}"`).toBe(false);
      }
    }
  });

  it('passes an analyzer rule on whole, never edited into a sentence of its own', () => {
    // The rule was that this page may not PARAPHRASE the analyzer. It is not
    // that the page must print every rule the analyzer publishes: a capture's
    // window, ownership, anchor and selection rules are four paragraphs of
    // methodology, and stacking them under a figure buries the figure. Where
    // one is shown it is shown whole — interpolated as a single expression,
    // never sliced or joined into new prose.
    for (const source of sources) {
      const edited = source.text.match(
        /\b(windowRule|ownershipRule|anchorRule|selectionRule)\s*\.\s*(slice|replace|split|toLowerCase|toUpperCase)/g,
      );
      expect(edited, `${source.name} edits an analyzer rule`).toBeNull();
    }
  });

  it('sources every glossary entry from the analyzer document it belongs to', () => {
    // Wherever a definition IS shown, the app looks it up and shows what came
    // back. A fallback sentence would be the app defining an analyzer term.
    const readers = sources.filter((source) => source.text.includes('definitions['));
    expect(readers.length).toBeGreaterThan(0);
    for (const source of readers) {
      expect(
        /definitions\[[^\]]+\]\s*\?\?\s*['"`]/.test(source.text),
        `${source.name} supplies its own wording when the analyzer has none`,
      ).toBe(false);
    }
  });
});
