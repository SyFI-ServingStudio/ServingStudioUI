export type NodeKind = 'sum' | 'max' | 'scale' | 'leaf';

export interface Slot {
  readonly name: string;
  readonly kind: string;
  readonly config: string;
  readonly backend: string | null;
}

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ExactLeafStats {
  readonly input: JsonValue;
  readonly flops: number | null;
  readonly bytes: number | null;
  readonly tflops: number | null;
  readonly gbps: number | null;
}

interface RawContainerNode {
  readonly label?: string;
}

export interface RawLeafNode {
  readonly kind: 'leaf';
  readonly slot: Slot;
  readonly base: number;
  readonly stats: ExactLeafStats;
}

export interface RawSumNode extends RawContainerNode {
  readonly kind: 'sum';
  readonly children: readonly [RawCostNode, ...RawCostNode[]];
}

export interface RawMaxNode extends RawContainerNode {
  readonly kind: 'max';
  /** Rust manifest overlap divisor: max(child costs) / overlap. */
  readonly overlap: number;
  readonly children: readonly [RawCostNode, ...RawCostNode[]];
}

export interface RawScaleNode extends RawContainerNode {
  readonly kind: 'scale';
  readonly n: number;
  readonly children: readonly [RawCostNode];
}

export type RawCostNode = RawLeafNode | RawSumNode | RawMaxNode | RawScaleNode;

interface CostAnnotation {
  readonly id: number;
  readonly depth: number;
  readonly ms: number;
  readonly pct: number;
}

export interface LeafNode extends CostAnnotation {
  readonly kind: 'leaf';
  readonly slot: Slot;
  readonly base: number;
  readonly stats: ExactLeafStats;
}

export interface SumNode extends CostAnnotation, RawContainerNode {
  readonly kind: 'sum';
  readonly children: readonly [CostNode, ...CostNode[]];
}

export interface MaxNode extends CostAnnotation, RawContainerNode {
  readonly kind: 'max';
  readonly overlap: number;
  readonly children: readonly [CostNode, ...CostNode[]];
}

export interface ScaleNode extends CostAnnotation, RawContainerNode {
  readonly kind: 'scale';
  readonly n: number;
  readonly children: readonly [CostNode];
}

export type CostNode = LeafNode | SumNode | MaxNode | ScaleNode;

interface RootCostAnnotation {
  /** Wall-clock cost of the root combinator, distinct from summed leaf busy time. */
  readonly totalMs: number;
}

export type CostTree =
  | (LeafNode & RootCostAnnotation)
  | (SumNode & RootCostAnnotation)
  | (MaxNode & RootCostAnnotation)
  | (ScaleNode & RootCostAnnotation);

export class CostTreeValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`Invalid CostTree at ${path}: ${message}`);
    this.name = 'CostTreeValidationError';
  }
}

/** Shared failure constructor keeps schema and numeric validation errors on one
 * public boundary without making either module depend on the other. */
export function invalidCostTree(path: string, message: string): never {
  throw new CostTreeValidationError(path, message);
}
