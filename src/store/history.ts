import { getRows, type RowId } from '../lib/data.ts';
import { ancestorKeys } from '../lib/rowModel.ts';
import { appActions } from './appSlice.ts';
import { takeRequestId } from './requestIds.ts';
import { selectIsLocked } from './selectors.ts';
import { markRejected, markSaved, store } from './store.ts';
import type { Command, EditOp } from './types.ts';
import { reasonOf, validate } from './validator.ts';

const opsOf = (command: Command): EditOp[] =>
  command.kind === 'single' ? [command.op] : command.ops;

export function undo(): void {
  const state = store.getState().app;
  if (state.historyBusy) return;

  for (const rowId of Object.keys(state.edits).map(Number)) {
    if (state.edits[rowId]?.status === 'rejected') {
      store.dispatch(appActions.dismissRejection({ rowId }));
    }
  }

  const command = state.undoStack[state.undoStack.length - 1];
  if (command === undefined) {
    store.dispatch(appActions.say('Nothing to undo.'));
    return;
  }

  const ops = opsOf(command);

  if (ops.some((op) => selectIsLocked(state, op.rowId))) {
    store.dispatch(appActions.say('Some of those rows are still validating — try again in a moment.'));
    return;
  }

  store.dispatch(appActions.popUndo());
  const reverted: EditOp[] = ops.map((op) => ({
    rowId: op.rowId,
    from: op.to,
    to: op.from ?? sourceCalls(op.rowId),
  }));
  store.dispatch(appActions.applyOps({ ops: reverted, fromUndo: true }));

  afterHistory(ops, 'Undid');
}

export async function redo(): Promise<void> {
  const state = store.getState().app;
  if (state.historyBusy) return;

  const command = state.redoStack[state.redoStack.length - 1];
  if (command === undefined) {
    store.dispatch(appActions.say('Nothing to redo.'));
    return;
  }

  const ops = opsOf(command);
  if (ops.some((op) => selectIsLocked(state, op.rowId))) {
    store.dispatch(appActions.say('Some of those rows are still validating — try again in a moment.'));
    return;
  }

  store.dispatch(appActions.popRedo());
  store.dispatch(appActions.setHistoryBusy(true));

  const requestIds = new Map<RowId, number>();
  for (const op of ops) {
    const requestId = takeRequestId();
    requestIds.set(op.rowId, requestId);
    store.dispatch(appActions.startPending({ rowId: op.rowId, value: op.to, requestId }));
  }

  const applied: EditOp[] = [];
  const reasons: string[] = [];

  await Promise.all(
    ops.map(async (op) => {
      const requestId = requestIds.get(op.rowId)!;
      try {
        await validate(op.to);
        if (markSaved(op.rowId, requestId)) applied.push(op);
        else store.dispatch(appActions.noteStaleReply());
      } catch (error) {
        const reason = reasonOf(error);
        if (markRejected(op.rowId, requestId, reason)) reasons.push(reason);
        else store.dispatch(appActions.noteStaleReply());
      }
    }),
  );

  // Only the rows that succeeded go back on the undo stack.
  const result: Command | null =
    applied.length === 0
      ? null
      : command.kind === 'single'
        ? { kind: 'single', op: applied[0]! }
        : { kind: 'bulk', label: command.label, ops: applied };

  store.dispatch(appActions.pushRedoResult(result));

  if (applied.length === 0) {
    store.dispatch(appActions.say(`Redo failed: ${reasons[0] ?? 'validation rejected'}.`));
    return;
  }
  afterHistory(applied, 'Redid');
}

function afterHistory(ops: EditOp[], verb: string): void {
  const { filters } = store.getState().app;
  const rows = getRows();
  const needle = filters.search.trim().toLowerCase();

  const visible = ops.filter((op) => {
    const row = rows[op.rowId]!;
    if (filters.region !== null && row.region !== filters.region) return false;
    if (needle === '') return true;
    return (
      row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)
    );
  });

  const count = ops.length;
  const plural = count === 1 ? 'change' : 'changes';

  if (visible.length === 0) {
    store.dispatch(
      appActions.setHiddenNotice({
        text: `${verb} ${count} ${plural}, but the current filter is hiding ${count === 1 ? 'that row' : 'those rows'}.`,
        rowId: ops[0]!.rowId,
      }),
    );
    store.dispatch(appActions.say(`${verb} ${count} ${plural} in hidden rows.`));
    return;
  }

  const target = visible[0]!.rowId;
  store.dispatch(appActions.expandGroups(ancestorKeys(target)));
  store.dispatch(appActions.requestReveal(target));
  store.dispatch(
    appActions.say(`${verb} ${count} ${plural} in ${rows[target]!.region} / ${rows[target]!.territory}.`),
  );
}

export function clearFilterAndShow(rowId: RowId): void {
  store.dispatch(appActions.setSearch(''));
  store.dispatch(appActions.setRegion(null));
  store.dispatch(appActions.setHiddenNotice(null));
  store.dispatch(appActions.expandGroups(ancestorKeys(rowId)));
  store.dispatch(appActions.requestReveal(rowId));
}

function sourceCalls(rowId: RowId): number {
  const value = getRows()[rowId]!.calls;
  return typeof value === 'number' ? value : Number(value);
}
