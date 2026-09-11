/**
 * Opening a deeper scope from a breakdown row.
 *
 * The path part is `selectSegment` folded over the segments, which is the same
 * rule every drill-down uses: a coordinate replaces whatever it invalidates.
 * What this adds is letting go of `panel=`.
 *
 * ## Why the pin has to go
 *
 * A pinned panel is a request to look at one thing, and the pruning rule keeps
 * it for as long as it still applies. A breakdown panel applies at every depth
 * below itself — the run's kernel time is the run's kernel time whether or not
 * a pool is selected — so a reader who followed `?panel=run.kernel-time` and
 * clicked a pool would change the address, keep the pin, and see the same
 * panel: the row visibly does nothing. The panel that is *about* the pool is
 * one the pin is hiding.
 *
 * Dropping it shows the page at the new depth, which contains that panel and
 * everything else that belongs there. The link the reader arrived on did its
 * job; the click after it is exploration, and exploration is what the page is
 * for.
 *
 * ## Where this is not the rule
 *
 * The system map's rows are not breakdowns. Its whole purpose is to *be* the
 * navigator, so a reader pinned to it and clicking a worker wants the map with
 * that worker selected — not to be taken off the map they were using. It
 * selects with `location/focus.ts` directly, and that difference is deliberate.
 */
import { selectSegment, withPanel, type Focus, type Segment } from '../location';

export function descendTo(focus: Focus, ...segments: readonly Segment[]): Focus {
  return withPanel(segments.reduce(selectSegment, focus), null);
}
