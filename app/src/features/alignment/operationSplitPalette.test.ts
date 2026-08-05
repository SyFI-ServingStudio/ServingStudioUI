import { describe, expect, it } from 'vitest';

import type { AlignmentMappedOperation } from '../../domain/alignment';
import { GROUP } from '../../domain/cost-tree';
import { tokens } from '../../theme';
import {
  operationPalette,
  rotatingOperationColors,
  shadeOf,
  shortOperationName,
  withAlpha,
} from './operationSplitPalette';

function operation(name: string, type: string): AlignmentMappedOperation {
  return { operation: name, role: name, type, simulatedSlots: [], measuredRows: 1 };
}

const operations: readonly AlignmentMappedOperation[] = [
  operation('layer.qkv_projection', 'gemm'),
  operation('layer.output_projection', 'gemm'),
  operation('layer.up_gate_projection', 'gemm'),
  operation('layer.attention', 'attention'),
  operation('layer.mlp_allreduce', 'collective'),
];

describe('operationPalette', () => {
  const palette = operationPalette(operations);

  it('keeps a family recognisable while separating its members', () => {
    const gemm = operations
      .filter((entry) => entry.type === 'gemm')
      .map((entry) => palette.colorOf(entry.operation));
    expect(new Set(gemm).size).toBe(gemm.length);
    expect(gemm).toEqual(tokens.operationColorPanel.slice(0, 3));
  });

  it('keeps every mapped operation on the rotating panel', () => {
    expect(palette.colorOf('layer.up_gate_projection')).toBe(tokens.operationColorPanel[2]);
    expect(palette.colorOf('layer.up_gate_projection')).not.toBe(palette.unmapped);
  });

  it('starts a fresh mapping at the first panel colour', () => {
    expect(palette.colorOf('layer.attention')).toBe(tokens.operationColorPanel[3]);
    expect(operationPalette([operation('solo', 'attention')]).colorOf('solo')).toBe(
      tokens.operationColorPanel[0],
    );
  });

  it('gives an unmapped segment one colour that belongs to no family', () => {
    expect(palette.colorOf(null)).toBe(palette.unmapped);
    expect(palette.colorOf('never.labelled')).toBe(palette.unmapped);
    const familyColors = operations.map((entry) => palette.colorOf(entry.operation));
    expect(familyColors).not.toContain(palette.unmapped);
  });

  it('does not move a colour when a different cycle is picked', () => {
    const again = operationPalette(operations);
    expect(again.colorOf('layer.up_gate_projection')).toBe(
      palette.colorOf('layer.up_gate_projection'),
    );
  });

  it('uses the label only as a key and rotates by mapping order', () => {
    const colors = rotatingOperationColors([
      { operation: 'moe.up_gate_projection' },
      { operation: 'arbitrary_operation' },
      { operation: 'moe.up_gate_projection' },
    ]);
    expect(colors['moe.up_gate_projection']).toBe(tokens.operationColorPanel[0]);
    expect(colors.arbitrary_operation).toBe(tokens.operationColorPanel[1]);
  });
});

describe('shadeOf', () => {
  it('returns the family colour unchanged at step zero', () => {
    expect(shadeOf(GROUP.comm.color, 0)).toBe(GROUP.comm.color);
  });

  it('climbs towards paper and drops towards ink', () => {
    const channels = (color: string): number[] =>
      color
        .replace(/[a-z()]/g, '')
        .split(',')
        .map(Number);
    const base = channels(shadeOf(GROUP.gemm.color, 1));
    const lighter = channels(shadeOf(GROUP.gemm.color, 3));
    const darker = channels(shadeOf(GROUP.gemm.color, -1));
    expect(lighter[0]).toBeGreaterThan(base[0]);
    expect(darker[0]).toBeLessThan(base[0]);
  });
});

describe('withAlpha', () => {
  it('carries a shared colour through at partial opacity', () => {
    expect(withAlpha(tokens.teal, 0.5)).toBe('rgba(31, 111, 107, 0.5)');
  });
});

describe('shortOperationName', () => {
  it('drops the qualifier that repeats on every row', () => {
    expect(shortOperationName('layer.attention_post_norm')).toBe('attention_post_norm');
    expect(shortOperationName('model.lm_head')).toBe('lm_head');
    expect(shortOperationName('unqualified')).toBe('unqualified');
  });
});
