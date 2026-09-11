import { predictionCasesRef, predictionDescriptorRef, type ReadRef } from '../../artifacts';
import { segmentOf } from '../../location';
import type { ContentPanelSpec, PageModeSpec } from '../types';

const CASE_PAGE_SIZE = 64;

function needs(location: Parameters<ContentPanelSpec['needs']>[0]): ReadRef[] {
  if (location.ref.kind !== 'prediction') return [];
  const result = { ...location.ref, kind: 'prediction' as const };
  const selectedCase = segmentOf(location.focus.path, 'case');
  const numericCase = Number(selectedCase?.id);
  const offset =
    Number.isSafeInteger(numericCase) && numericCase >= 0
      ? Math.floor(numericCase / CASE_PAGE_SIZE) * CASE_PAGE_SIZE
      : 0;
  return [predictionDescriptorRef(result), predictionCasesRef(result, offset, CASE_PAGE_SIZE)];
}

export const predictionPageSpec = {
  id: 'prediction.page',
  title: 'Timing prediction',
  mode: 'panel',
  scope: false,
  kinds: ['prediction'],
  consumes: [],
  options: ['optimality'],
  needs,
  load: async () => (await import('./PredictionPage')).PredictionPage,
} satisfies ContentPanelSpec;

function pageMode(id: string, title: string, consumes: PageModeSpec['consumes']): PageModeSpec {
  return {
    id,
    title,
    mode: 'page',
    layoutMode: 'prediction-page',
    kinds: ['prediction'],
    consumes,
    options: ['optimality'],
    needs,
  };
}

export const predictionPageModes = [
  pageMode('cost-tree', 'Prediction CostTree', ['case', 'caseOperation']),
  pageMode('kernel-time-share', 'Prediction kernel time share', ['case', 'caseOperation', 'leaf']),
  pageMode('kernel-throughput', 'Prediction kernel throughput', ['case', 'caseOperation', 'leaf']),
  pageMode('kernel-input-distribution', 'Prediction kernel input distribution', [
    'case',
    'caseOperation',
    'leaf',
  ]),
  pageMode('optimality-breakdown', 'Prediction optimality waterfall', ['case']),
  pageMode('optimality-kernel-ladder', 'Prediction optimality kernel ladder', ['case']),
  pageMode('optimality-kernels', 'Prediction per-kernel optimality', ['case']),
] as const;
