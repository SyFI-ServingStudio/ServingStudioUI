import { SectionPanelToggle } from './SectionPanelToggle';

export type WorkerAnalysisLevel = 'worker' | 'iteration';

export function WorkerAnalysisLevelToggle({
  level,
  onChange,
}: {
  readonly level: WorkerAnalysisLevel;
  onChange(level: WorkerAnalysisLevel): void;
}) {
  return (
    <SectionPanelToggle
      ariaLabel="Worker analysis level"
      value={level}
      options={[
        { value: 'worker', label: 'Worker' },
        { value: 'iteration', label: 'Iteration' },
      ]}
      onChange={(nextLevel) => onChange(nextLevel as WorkerAnalysisLevel)}
    />
  );
}
