import type { KernelInputPosition } from '../artifacts';
import type { Optimality } from '../artifacts';

interface SubjectPayloads {
  readonly kernelInputDistribution: {
    readonly positions: readonly KernelInputPosition[];
    readonly sampling: { readonly stride: number };
  };
  readonly optimality: Optimality;
}

export type PanelSubjectName = keyof SubjectPayloads;

/** Legacy-shaped six-state projection used by the carried-over evidence views. */
export type SubjectResult<Name extends PanelSubjectName> =
  | {
      readonly subject: Name;
      readonly status: 'ready';
      readonly schemaVersion: number;
      readonly payload: SubjectPayloads[Name];
    }
  | { readonly subject: Name; readonly status: 'pending'; readonly reason?: string }
  | {
      readonly subject: Name;
      readonly status: 'unavailable';
      readonly reason: string;
      readonly code?: string;
    }
  | { readonly subject: Name; readonly status: 'not_generated'; readonly reason?: string }
  | {
      readonly subject: Name;
      readonly status: 'failed';
      readonly code: string;
      readonly reason: string;
    }
  | {
      readonly subject: Name;
      readonly status: 'incompatible';
      readonly reason: string;
      readonly receivedSchemaVersion?: number;
    };
