/**
 * What a result page is made of.
 *
 * A layout is an ordered list of sections, and a section is an ordered list of
 * panels. Ordering is therefore a value in one file per result kind, rather
 * than a convention spread across the components that happen to render — which
 * is what made the old page order impossible to state without reading every
 * feature directory.
 *
 * Layouts hold ids, not components. Nothing here can import a panel.
 */
import type { Focus, ResultKind, SegmentKind } from '../location';

export interface PanelToggleOption {
  readonly value: string;
  readonly label: string;
  readonly panel: string | null;
  readonly upTo: SegmentKind;
}

export interface SectionControl {
  readonly kind: 'panel-toggle';
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: readonly PanelToggleOption[];
}
type SectionText = string | ((focus: Focus) => string);

/** Optional reproduction of the existing numbered Analyzer section chrome. */
export interface SectionFrame {
  readonly idx: string;
  readonly title: SectionText;
  readonly sub?: SectionText;
  readonly accent: 'analysis' | 'structure' | 'optimality';
  readonly control?: SectionControl | ((focus: Focus) => SectionControl | null);
}

export interface Section {
  readonly title: string;
  /** A composite panel may reproduce its existing section chrome itself. */
  readonly heading?: boolean;
  readonly frame?: SectionFrame;
  /** Vertical spacing between panel rows, in theme spacing units. */
  readonly spacing?: number;
  /**
   * Fixed ids, or a function of the focus for sections whose contents depend on
   * how far the reader has drilled in. The function form is what lets "what you
   * are looking at now" be a section rather than a special case in the shell.
   */
  readonly panels: readonly string[] | ((focus: Focus) => readonly string[]);
  /** Visual rows over the same ids; multi-panel rows become responsive grids. */
  readonly rows?:
    readonly (readonly string[])[] | ((focus: Focus) => readonly (readonly string[])[]);
}

export interface LayoutSpec {
  readonly kind: ResultKind;
  readonly sections: readonly Section[];
  /** Complete page variants selected by page-mode panel specs. */
  readonly modes?: Readonly<Record<string, readonly Section[]>>;
}

/** Sections for the default page or one declared page mode. */
export function sectionsOf(layout: LayoutSpec, mode?: string): readonly Section[] | null {
  if (mode === undefined) return layout.sections;
  return layout.modes?.[mode] ?? null;
}

/** The panel ids a section names at this focus. */
export function panelsOf(section: Section, focus: Focus): readonly string[] {
  return typeof section.panels === 'function' ? section.panels(focus) : section.panels;
}

export function rowsOf(section: Section, focus: Focus): readonly (readonly string[])[] {
  if (section.rows === undefined) return panelsOf(section, focus).map((id) => [id]);
  return typeof section.rows === 'function' ? section.rows(focus) : section.rows;
}

export function frameOf(
  section: Section,
  focus: Focus,
): {
  readonly idx: string;
  readonly title: string;
  readonly sub?: string;
  readonly accent: SectionFrame['accent'];
  readonly control: SectionControl | null;
} | null {
  const frame = section.frame;
  if (frame === undefined) return null;
  const title = typeof frame.title === 'function' ? frame.title(focus) : frame.title;
  const sub =
    frame.sub === undefined
      ? undefined
      : typeof frame.sub === 'function'
        ? frame.sub(focus)
        : frame.sub;
  const control =
    frame.control === undefined
      ? null
      : typeof frame.control === 'function'
        ? frame.control(focus)
        : frame.control;
  return {
    idx: frame.idx,
    title,
    ...(sub === undefined ? {} : { sub }),
    accent: frame.accent,
    control,
  };
}
