import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RowId } from '../lib/data.ts';
import type { ColumnId, Filters, Sort } from '../lib/rowModel.ts';
import type { BulkProgress, BulkResult, CellState, Command, EditOp } from './types.ts';

export const HISTORY_LIMIT = 100;

export interface AppState {
  edits: Record<RowId, CellState>;
  pendingCount: number;

  undoStack: Command[];
  redoStack: Command[];
  /** Set while a redo is running, so we don't start a second one on top. */
  historyBusy: boolean;

  selected: RowId[];
  selectionAnchor: RowId | null;
  bulkProgress: BulkProgress | null;
  bulkResult: BulkResult | null;

  sort: Sort | null;
  filters: Filters;
  collapsed: string[];
  editingRow: RowId | null;
  editingDraft: string;

  message: string;
  /** Set when we change a row the filter is hiding, so we can offer to show it. */
  hiddenNotice: { text: string; rowId: RowId } | null;
  /** Asks the grid to scroll to a row and flash it. */
  revealRow: { rowId: RowId; nonce: number } | null;
  staleReplies: number;
}

/**
 * `selected`/`collapsed` are plain arrays in the store (Immer drafts don't play
 * well with `Set` without extra setup), so components that need `Set` semantics
 * — `.has()`, `.size` — build one locally with `useMemo`. See selectors.ts.
 */
function createInitialState(): AppState {
  return {
    edits: {},
    pendingCount: 0,

    undoStack: [],
    redoStack: [],
    historyBusy: false,

    selected: [],
    selectionAnchor: null,
    bulkProgress: null,
    bulkResult: null,

    sort: null,
    filters: { search: '', region: null },
    collapsed: [],
    editingRow: null,
    editingDraft: '',

    message: '',
    hiddenNotice: null,
    revealRow: null,
    staleReplies: 0,
  };
}

let revealNonce = 0;

const appSlice = createSlice({
  name: 'app',
  initialState: createInitialState(),
  reducers: {
    startPending: (state, action: PayloadAction<{ rowId: RowId; value: number; requestId: number }>) => {
      const { rowId, value, requestId } = action.payload;
      const previous = state.edits[rowId];
      const alreadyPending = previous?.status === 'pending';
      state.edits[rowId] = {
        status: 'pending',
        committed: previous ? previous.committed : null,
        pendingValue: value,
        requestId,
      };
      if (!alreadyPending) state.pendingCount += 1;
    },

    /** Unconditional apply — the caller (see store.ts) has already checked the requestId is still current. */
    markSaved: (state, action: PayloadAction<{ rowId: RowId; value: number }>) => {
      const { rowId, value } = action.payload;
      state.edits[rowId] = { status: 'saved', committed: value, fromUndo: false };
      state.pendingCount = Math.max(0, state.pendingCount - 1);
    },

    /** Unconditional apply — see markSaved. */
    markRejected: (
      state,
      action: PayloadAction<{ rowId: RowId; committed: number | null; attempted: number; reason: string }>,
    ) => {
      const { rowId, committed, attempted, reason } = action.payload;
      state.edits[rowId] = { status: 'rejected', committed, attempted, reason };
      state.pendingCount = Math.max(0, state.pendingCount - 1);
    },

    /** Used when a bulk run is cancelled: unlock the row, keep its old value. */
    releasePending: (state, action: PayloadAction<{ rowId: RowId }>) => {
      const { rowId } = action.payload;
      const edit = state.edits[rowId];
      if (edit?.status !== 'pending') return;
      if (edit.committed === null) delete state.edits[rowId];
      else state.edits[rowId] = { status: 'saved', committed: edit.committed, fromUndo: false };
      state.pendingCount = Math.max(0, state.pendingCount - 1);
    },

    dismissRejection: (state, action: PayloadAction<{ rowId: RowId }>) => {
      const { rowId } = action.payload;
      const edit = state.edits[rowId];
      if (edit?.status !== 'rejected') return;
      if (edit.committed === null) delete state.edits[rowId];
      else state.edits[rowId] = { status: 'saved', committed: edit.committed, fromUndo: false };
    },

    noteStaleReply: (state) => {
      state.staleReplies += 1;
    },

    pushCommand: (state, action: PayloadAction<Command>) => {
      state.undoStack.push(action.payload);
      // Cap the stack so a long session can't grow without limit.
      if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
      // Doing something new means the old "future" no longer applies.
      state.redoStack = [];
    },

    /**
     * Write a list of ops straight into the edits map.
     *
     * `fromUndo` marks the cell as changed-but-not-revalidated, because undo
     * doesn't call the validator — see the comment in history.ts.
     */
    applyOps: (state, action: PayloadAction<{ ops: EditOp[]; fromUndo: boolean }>) => {
      const { ops, fromUndo } = action.payload;
      for (const op of ops) {
        if (op.to === null) continue;
        state.edits[op.rowId] = { status: 'saved', committed: op.to, fromUndo };
      }
    },

    popUndo: (state) => {
      const command = state.undoStack.pop();
      if (command !== undefined) state.redoStack.push(command);
    },

    popRedo: (state) => {
      state.redoStack.pop();
    },

    setHistoryBusy: (state, action: PayloadAction<boolean>) => {
      state.historyBusy = action.payload;
    },

    /**
     * After a redo finishes. Only the rows that succeeded go back on the undo
     * stack, and the rest of the redo stack is thrown away because the app is no
     * longer in the state those entries expected.
     */
    pushRedoResult: (state, action: PayloadAction<Command | null>) => {
      if (action.payload !== null) state.undoStack.push(action.payload);
      state.redoStack = [];
      state.historyBusy = false;
    },

    toggleRow: (state, action: PayloadAction<RowId>) => {
      const rowId = action.payload;
      const selected = new Set(state.selected);
      if (selected.has(rowId)) selected.delete(rowId);
      else selected.add(rowId);
      state.selected = [...selected];
      state.selectionAnchor = rowId;
    },

    selectRows: (state, action: PayloadAction<{ rowIds: RowId[]; select: boolean }>) => {
      const { rowIds, select } = action.payload;
      const selected = new Set(state.selected);
      for (const id of rowIds) {
        if (select) selected.add(id);
        else selected.delete(id);
      }
      state.selected = [...selected];
    },

    clearSelection: (state) => {
      state.selected = [];
      state.selectionAnchor = null;
    },

    setBulkProgress: (state, action: PayloadAction<BulkProgress | null>) => {
      state.bulkProgress = action.payload;
    },

    bumpBulkProgress: (state) => {
      if (state.bulkProgress !== null) state.bulkProgress.done += 1;
    },

    setBulkResult: (state, action: PayloadAction<BulkResult | null>) => {
      state.bulkResult = action.payload;
    },

    /** none -> asc -> desc -> none */
    cycleSort: (state, action: PayloadAction<ColumnId>) => {
      const column = action.payload;
      if (state.sort === null || state.sort.column !== column) {
        state.sort = { column, dir: 'asc' };
      } else if (state.sort.dir === 'asc') {
        state.sort = { column, dir: 'desc' };
      } else {
        state.sort = null;
      }
    },

    setSearch: (state, action: PayloadAction<string>) => {
      state.filters.search = action.payload;
    },

    setRegion: (state, action: PayloadAction<string | null>) => {
      state.filters.region = action.payload;
    },

    toggleGroup: (state, action: PayloadAction<string>) => {
      const key = action.payload;
      const collapsed = new Set(state.collapsed);
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      state.collapsed = [...collapsed];
    },

    setCollapsed: (state, action: PayloadAction<string[]>) => {
      state.collapsed = [...new Set(action.payload)];
    },

    expandGroups: (state, action: PayloadAction<string[]>) => {
      const collapsed = new Set(state.collapsed);
      for (const key of action.payload) collapsed.delete(key);
      state.collapsed = [...collapsed];
    },

    startEditing: (state, action: PayloadAction<{ rowId: RowId; draft: string }>) => {
      state.editingRow = action.payload.rowId;
      state.editingDraft = action.payload.draft;
    },

    changeDraft: (state, action: PayloadAction<string>) => {
      state.editingDraft = action.payload;
    },

    stopEditing: (state) => {
      state.editingRow = null;
      state.editingDraft = '';
    },

    say: (state, action: PayloadAction<string>) => {
      state.message = action.payload;
    },

    setHiddenNotice: (state, action: PayloadAction<{ text: string; rowId: RowId } | null>) => {
      state.hiddenNotice = action.payload;
    },

    requestReveal: {
      reducer: (state, action: PayloadAction<{ rowId: RowId; nonce: number }>) => {
        state.revealRow = action.payload;
      },
      prepare: (rowId: RowId) => ({ payload: { rowId, nonce: ++revealNonce } }),
    },

    clearReveal: (state) => {
      state.revealRow = null;
    },

    resetAll: () => createInitialState(),
  },
});

export const appActions = appSlice.actions;
export const appReducer = appSlice.reducer;
