import type { RowId } from '../lib/data.ts';

export type CellState =
  | { status: 'pending'; committed: number | null; pendingValue: number; requestId: number }
  | { status: 'saved'; committed: number; fromUndo: boolean }
  | { status: 'rejected'; committed: number | null; attempted: number; reason: string };
export interface EditOp {
  rowId: RowId;
  from: number | null;
  to: number;
}

export type Command =
  | { kind: 'single'; op: EditOp }
  | { kind: 'bulk'; label: string; ops: EditOp[] };

export type SkipReason = 'no-change' | 'locked' | 'not-a-number';

export interface BulkResult {
  label: string;
  applied: number;
  rejected: number;
  skipped: number;
  selected: number;
  /** How many affected rows the current filter is hiding. */
  hidden: number;
  reasons: { reason: string; count: number }[];
  skipReasons: { reason: SkipReason; count: number }[];
}

export interface BulkProgress {
  label: string;
  total: number;
  done: number;
}
