import { describe, expect, it } from 'vitest';

import { allPanels } from '../panels/registry';
import { layoutFor } from './index';
import { sectionsOf } from './types';

describe('page-mode layout registration', () => {
  it('registers every page mode in each layout it applies to', () => {
    for (const spec of allPanels()) {
      if (spec.mode !== 'page') continue;
      for (const kind of spec.kinds) {
        const layout = layoutFor(kind);
        expect(layout, `${spec.id} has no ${kind} layout`).not.toBeNull();
        expect(
          layout === null ? null : sectionsOf(layout, spec.layoutMode),
          `${spec.id} names missing layout mode ${spec.layoutMode}`,
        ).not.toBeNull();
      }
    }
  });
});
