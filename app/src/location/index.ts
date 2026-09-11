/**
 * The public surface of `location/`.
 *
 * `grammar.ts` is deliberately absent, and so are the path codec's own
 * `encodePath`/`decodePath`: the URL spelling is an implementation detail of
 * `parse`/`format`, and no panel should ever build or split a hash by hand. What
 * consumers get is the type, the pure transformations, and the two ends of the
 * serialization.
 *
 * This module imports nothing from the rest of the application, so a `Location`
 * carries no dependency on the layers above it.
 */
export {
  EMPTY_FOCUS,
  canonicalKinds,
  catalogFilterSchema,
  chatRefSchema,
  conversationIdSchema,
  fileRefSchema,
  focusSchema,
  locationSchema,
  panelOptionsSchema,
  resultIdSchema,
  resultKindSchema,
  resultRefSchema,
  segmentSchema,
  workspaceIdSchema,
  workspaceOf,
  type CatalogFilter,
  type ChatRef,
  type ConversationId,
  type FileRef,
  type Focus,
  type Location,
  type PanelOptions,
  type ResultId,
  type ResultKind,
  type ResultRef,
  type Segment,
  type SegmentKind,
  type WorkspaceId,
} from './types';
export { OPTION_KEY_PATTERN } from './grammar';
export { isValidPath, segmentOf } from './segments';
export { atRoot, selectSegment, upTo, withCursor, withOption, withPanel, withPath } from './focus';
export { parseLocation, type LocationDefaults } from './parse';
export { formatLocation, sameLocation } from './format';
export {
  defaultWorkspace,
  navigate,
  useLocation,
  type Navigate,
  type NavigateIntent,
} from './navigate';
