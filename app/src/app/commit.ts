/**
 * The one place a `Location` is pruned before it becomes an address.
 *
 * Moving up out of a worker invalidates the panel that was showing that worker,
 * and the options that panel claimed. The old store expressed this by making
 * every selection action clean up after itself — `selectPool` cleared the run
 * panel id, `setTime` cleared the operation — which meant the policy existed
 * only as the sum of those actions and could not be stated, tested, or changed
 * in one place.
 *
 * Here it is stated once. `location/focus.ts` changes exactly the field it is
 * asked to change; this decides what that makes stale, and `navigate` writes
 * the result.
 */
import { appliesAt, claimedOptions, panelSpec } from '../panels/registry';
import { resolveResult } from './resolve';
import { navigate, type Location, type NavigateIntent, type PanelOptions } from '../location';

/**
 * Prune, then navigate.
 *
 * Every navigation in the application goes through this, so there is no path by
 * which an address can be written without the pruning having been applied.
 */
export function commit(location: Location, intent: NavigateIntent = 'push'): void {
  navigate(prune(location), intent);
}

/**
 * What survives at this address.
 *
 * Pure, so the rule can be tested without a browser and asserted against
 * without watching for a side effect.
 */
export function prune(location: Location): Location {
  if (location.view !== 'result') return location;
  const focus = location.focus;
  const panel = keptPanel(focus.panel, location);
  // The panel decision first, and the options against its *result*: an option
  // is kept because something on the page reads it, and whether the panel that
  // reads it is still on the page is exactly what was just decided.
  const options = keptOptions(focus.options, { ...location, focus: { ...focus, panel } });
  if (panel === focus.panel && options === focus.options) return location;
  return { ...location, focus: { ...focus, panel, options } };
}

/**
 * The panel, if it still applies here.
 *
 * Three ways to lose it: the id names nothing this build has — a link from an
 * older or newer deployment — the panel is not about this kind of result, or
 * the drill-down it needs is no longer on the path. All three mean the address
 * should carry no panel rather than a broken one, because a panel id that
 * survives its own preconditions is exactly what makes a shared link render an
 * error for the person who receives it.
 */
function keptPanel(
  panel: string | null,
  location: Extract<Location, { view: 'result' }>,
): string | null {
  if (panel === null) return null;
  // One lookup answers both questions. Asking `isPanelId` first and then for
  // the spec read the same table twice and left a second failure branch that
  // nothing could reach.
  const spec = panelSpec(panel);
  if (spec === null) return null;
  return appliesAt(spec, location.ref.kind, location.focus) ? panel : null;
}

/**
 * The option keys that still have a reader.
 *
 * A reader, not an owner. An option survives while some panel *on this page*
 * claims it, which is not the same as belonging to one panel: the queue
 * statistic is one choice rendered at two depths, and a rule that tied it to a
 * single panel id would show the reader the average again the moment they
 * opened a pool. A key nothing on the page claims goes, because nothing can
 * read it — that is what keeps a URL from accumulating state the application
 * cannot explain.
 *
 * The page is resolved rather than guessed at, so this and what actually
 * renders cannot drift: `?panel=` means one panel and its options, and no
 * `panel=` means the layout, which is a different set at every depth.
 */
function keptOptions(
  options: PanelOptions,
  location: Extract<Location, { view: 'result' }>,
): PanelOptions {
  const owned = readersAt(location);
  const kept: PanelOptions = {};
  let dropped = false;
  for (const [key, value] of Object.entries(options)) {
    if (owned.has(key)) {
      kept[key] = value;
      continue;
    }
    dropped = true;
    if (import.meta.env.DEV && !claimedOptions().has(key)) {
      // Dropped either way, but a key no panel claims is a different mistake
      // from one that belonged to the panel just left: it means something built
      // a URL out of a value nothing can read.
      console.warn(`commit: option "${key}" is claimed by no panel and was dropped`);
    }
  }
  return dropped ? kept : options;
}

/** Every option key claimed by a panel this address actually renders. */
function readersAt(location: Extract<Location, { view: 'result' }>): ReadonlySet<string> {
  const resolution = resolveResult(location);
  if (resolution.status === 'unaddressable') return new Set();
  const panels =
    resolution.status === 'panel'
      ? [resolution.panel]
      : resolution.sections.flatMap((section) => [...section.panels]);
  return new Set(panels.flatMap((spec) => [...spec.options]));
}
