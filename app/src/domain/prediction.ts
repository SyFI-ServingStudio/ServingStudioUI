import type { CostTree, JsonValue } from './cost-tree';
import type { OptimalityIterationWaterfallData, OptimalityKernelLadderData } from './optimality';
import type { KernelThroughputAnalysisData } from './kernelThroughputAnalysis';
import type { WorkerCostTreeInput } from './workerOperation';

export interface PredictionDescriptor {
  readonly predictionId: string;
  readonly displayName: string;
  readonly selector: 'iter' | 'attn' | 'ffn';
  readonly archType: string;
  readonly gpu: { readonly name: string; readonly count: number };
  readonly caseCount: number;
  readonly lifecycle: {
    readonly prediction: 'pending' | 'complete';
    readonly analysis: 'not_started' | 'complete';
  };
  readonly kernelInputDistributionAvailable: boolean;
}

export interface PredictionOperationSummary {
  readonly operationId: string;
  readonly section: string;
  readonly layer: number;
  readonly timeMs: number;
}

export interface PredictionCase {
  readonly caseId: string;
  readonly input: JsonValue;
  readonly totalTimeMs: number;
  readonly operations: readonly PredictionOperationSummary[];
}

export interface PredictionCasePage {
  readonly predictionId: string;
  readonly offset: number;
  readonly total: number;
  readonly cases: readonly PredictionCase[];
}

export interface PredictionOperationRef {
  readonly predictionId: string;
  readonly caseId: string;
  readonly operationId: string;
}

export interface PredictionCostTreeDetail extends PredictionOperationRef {
  readonly section: string;
  readonly layer: number;
  readonly interval: { readonly startMs: number; readonly endMs: number };
  readonly inputs: readonly WorkerCostTreeInput[];
  readonly tree: CostTree;
}

export interface PredictionKernelThroughputAnalysis
  extends PredictionOperationRef, KernelThroughputAnalysisData {}

export interface PredictionOptimalityKernelLadder extends OptimalityKernelLadderData {
  readonly predictionId: string;
  readonly caseId: string;
}

export interface PredictionOptimalityWaterfall extends OptimalityIterationWaterfallData {
  readonly predictionId: string;
  readonly caseId: string;
}
