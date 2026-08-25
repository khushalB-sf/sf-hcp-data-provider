import type { RowId } from '../lib/data.ts';

/**
 * FR-4: what state a cell can be in while it's being edited.
 *
 * `committed` is the last value the validator said yes to. `null` means there
 * is no accepted edit, so the app falls back to the source value.
 *
 * `pending` is deliberately a separate field from `committed`. Everything that
 * reads a cell's value uses `committed ?? source`, so a value that's still
 * being validated can't accidentally end up in a subtotal — which is what FR-2
 * asks for.
 */
export type CellState =
  | { status: 'pending'; committed: number | null; pendingValue: number; requestId: number }
  | { status: 'saved'; committed: number; fromUndo: boolean }
  | { status: 'rejected'; committed: number | null; attempted: number; reason: string };

/**
 * FR-4: one entry in the undo history.
 *
 * This stores what CHANGED, not a copy of the data. A copy of 50,000 rows per
 * undo step would use a lot of memory, and restoring one would also undo
 * sorting and filtering, which isn't what the user asked for.
 *
 * `rowId` is the row's index in the source array, so the entry still points at
 * the right row after the user sorts, filters or collapses anything.
 */
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
