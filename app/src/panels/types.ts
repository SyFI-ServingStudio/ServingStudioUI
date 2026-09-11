/**
 * What a panel is, as data.
 *
 * A spec describes either a component to load or a complete page mode. The
 * description is readable without loading anything, so the shell can decide
 * what a URL names, what it will read, and whether it applies here first.
 *
 * A content spec may not import its component. Its `load` is a dynamic import,
 * so the spec stays in the eager bundle and the component does not. A page-mode
 * spec has no component; its layout names the content specs to render.
 */
import type { ReadRef } from '../artifacts';
import type { Location, Navigate, ResultKind, SegmentKind } from '../location';

/** Everything a panel is given. It reads its own artifacts from the address. */
export interface PanelProps {
  readonly location: Extract<Location, { view: 'result' }>;
  readonly navigate: Navigate;
}

export type PanelComponent = (props: PanelProps) => React.ReactNode;

interface PanelSpecBase {
  /** Matches this panel's key in the registry; the registry is the authority. */
  readonly id: string;
  readonly title: string;
  /**
   * What this panel will read at that address.
   *
   * A pure function, so the shell can prefetch and a test can assert what a
   * panel touches without rendering it. The panel still calls `useArtifact`
   * itself — this is a declaration, not a delivery mechanism.
   */
  needs(location: Extract<Location, { view: 'result' }>): ReadRef[];
  /**
   * The kinds of result this panel is about.
   *
   * A panel reads named subjects of a named result, and the kinds do not serve
   * the same ones: `#/result/prediction/p1?panel=run.system-map` would otherwise
   * resolve, mount, and ask a prediction for a measured run's topology. The
   * address is what a reader shares, so the refusal has to be legible — and the
   * shell can only give one before loading anything if the spec says so.
   *
   * Never empty: a panel no address can reach is dead code that still ships.
   */
  readonly kinds: readonly ResultKind[];
  /**
   * The drill-down segments this panel needs on the path.
   *
   * A panel that needs a worker cannot render at cluster level, and this is how
   * the shell knows that without asking the panel. It is also the pruning rule:
   * navigating up past a segment listed here drops the panel from the address
   * rather than leaving it there to fail.
   */
  readonly consumes: readonly SegmentKind[];
  /**
   * The `focus.options` keys this panel claims.
   *
   * Declared so that a key nobody claims can be found — an option that survives
   * in URLs while no panel reads it is a value the application cannot explain.
   */
  readonly options: readonly string[];
}

/** A panel that can be rendered either alone or inside a page layout. */
export interface ContentPanelSpec extends PanelSpecBase {
  readonly mode: 'panel';
  /** False when a named layout places this composite explicitly. */
  readonly scope?: boolean;
  /** A dynamic import. Never a static one: that would defeat the split. */
  load(): Promise<PanelComponent>;
}

/** A URL-visible mode switch that selects a complete layout variant.
 *
 * It has no component of its own: the selected layout names the content
 * panels. This is how an iteration workbench keeps the run overview and system
 * map around it while an ordinary citation still opens one panel alone.
 */
export interface PageModeSpec extends PanelSpecBase {
  readonly mode: 'page';
  readonly layoutMode: string;
}

export type PanelSpec = ContentPanelSpec | PageModeSpec;
