import { getRows, toNumber, type RowId } from '../lib/data.ts';
import type { AppState } from './appSlice.ts';

/**
 * The value to show / sort / add up for a row.
 *
 * Note this reads `committed`, never `pendingValue` — that's how a cell
 * that's still validating stays out of the group totals.
 */
export function makeCallsOf(edits: AppState['edits']) {
  return (rowId: RowId): number => {
    const edit = edits[rowId];
    const source = toNumber(getRows()[rowId]!.calls);
    return edit === undefined ? source : edit.committed ?? source;
  };
}

export const selectCallsOf = (state: AppState, rowId: RowId): number =>
  makeCallsOf(state.edits)(rowId);

export const selectIsLocked = (state: AppState, rowId: RowId): boolean =>
  state.edits[rowId]?.status === 'pending';
