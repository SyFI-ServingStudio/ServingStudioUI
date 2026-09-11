import { describe, expect, it } from 'vitest';

import type { AlignmentMappedOperation } from '../../artifacts/schema/alignmentTypes';
import { operationPalette, rotatingOperationColors } from './operationSplitPalette';

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

  it('gives an unmapped segment one colour that belongs to no family', () => {
    expect(palette.colorOf(null)).toBe(palette.unmapped);
    expect(palette.colorOf('never.labelled')).toBe(palette.unmapped);
    const familyColors = operations.map((entry) => palette.colorOf(entry.operation));
    expect(familyColors).not.toContain(palette.unmapped);
  });

  it('assigns one stable color per unique operation key', () => {
    const colors = rotatingOperationColors([
      { operation: 'moe.up_gate_projection' },
      { operation: 'arbitrary_operation' },
      { operation: 'moe.up_gate_projection' },
    ]);
    expect(Object.keys(colors)).toHaveLength(2);
    expect(colors['moe.up_gate_projection']).not.toBe(colors.arbitrary_operation);
    expect(colors).toEqual(
      rotatingOperationColors([
        { operation: 'moe.up_gate_projection' },
        { operation: 'arbitrary_operation' },
      ]),
    );
  });
});
