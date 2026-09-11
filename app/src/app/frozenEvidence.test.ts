import { describe, expect, it } from 'vitest';

import { evidenceDestination } from './evidence';
import { formatLocation } from '../location';
import golden from '../test/fixtures/agent-citations/golden.json';
import { frozenCitationV2Schema } from '../session/citation';
import { agentV1EvidenceRefSchema } from '../session/evidenceRef';

const addresses: Record<string, string> = {
  aggregate:
    '#/result/sweep/e_private?w=w_main&at=run:r_private~%7B%22tensor_parallel%22%3A2%7D&panel=sweep.page&o.evidence-panel=total_tps&o.metric=total_tps',
  run: '#/result/run/r_private?w=w_main&o.evidence-panel=concurrency',
  prediction: '#/result/prediction/p_private?w=w_main&o.optimality=unlocked',
  kernel_profile: '#/result/kernel-profile/kp_private?w=w_main&panel=overview',
  kernel_measurement:
    '#/result/kernel-measurement/km_private?w=w_main&panel=summary&o.metric=median',
};

describe('actual Agent frozen citation bytes', () => {
  it.each(golden)('reads and navigates $kind without altering persisted data', (entry) => {
    const before = JSON.stringify(entry);
    const citation = frozenCitationV2Schema.parse(entry.citation);
    expect(entry.text.slice(citation.sourceStart, citation.sourceEnd)).toBe(
      `\`${citation.token}\``,
    );
    const destination = evidenceDestination(entry.citation.target, null);
    expect(destination).not.toBeNull();
    expect(destination?.knownUnavailable).toBe(false);
    const address = formatLocation(destination!.location);
    expect(address).toBe(addresses[entry.kind]);
    expect(JSON.stringify(entry)).toBe(before);
  });

  it.each(golden.filter((entry) => entry.kind !== 'aggregate'))(
    'treats absent and explicit null $kind fields identically',
    (entry) => {
      const original = JSON.stringify(entry);
      const explicit = entry.dictionary.entries[0]!.target;
      expect(Object.values(explicit)).toContain(null);
      expect(agentV1EvidenceRefSchema.parse(entry.citation.target)).toEqual(
        agentV1EvidenceRefSchema.parse(explicit),
      );
      expect(evidenceDestination(entry.citation.target, null)).toEqual(
        evidenceDestination(explicit, null),
      );
      expect(JSON.stringify(entry)).toBe(original);
    },
  );

  it.each(golden)('rejects invalid $kind target values and keys without mutation', (entry) => {
    const identity = Object.keys(entry.citation.target).find(
      (key) => key.endsWith('Id') && key !== 'workspaceId' && key !== 'panelId',
    )!;
    const targets = [
      { ...entry.citation.target, workspaceId: 7 },
      { ...entry.citation.target, panelId: [] },
      { ...entry.citation.target, unknown: true },
      { ...entry.citation.target, workspaceId: undefined },
      { ...entry.citation.target, [identity]: undefined },
    ];
    for (const target of targets) {
      const before = JSON.stringify(target);
      expect(frozenCitationV2Schema.safeParse({ ...entry.citation, target }).success).toBe(false);
      expect(evidenceDestination(target, null)).toBeNull();
      expect(JSON.stringify(target)).toBe(before);
    }
  });
});
