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

/**
 * FR-4 / FR-6: undo.
 *
 * The important bit is that a command stores `rowId`, which is the row's index
 * in the source array. Sorting and filtering never change that array — they
 * just build lists of indexes — so an undo entry still points at the right row
 * no matter how the grid is currently arranged. I didn't have to write any
 * special handling for that; it falls out of using the index as the id.
 *
 * Undo does NOT re-validate. It's putting back a value the validator already
 * accepted, and the validator fails 10% of the time at random, so re-checking
 * would mean undo could just... not work, which would be worse than useless.
 *
 * A rejected edit never made it onto the stack (see actions.ts), so there's no
 * history entry undo could pop for it. Clear its error badge directly instead —
 * otherwise it would sit there forever, since undo is the only "put it back"
 * gesture most users will reach for.
 */
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

  // Same rule as everywhere else: a cell being validated can't be changed.
  if (ops.some((op) => selectIsLocked(state, op.rowId))) {
    store.dispatch(appActions.say('Some of those rows are still validating — try again in a moment.'));
    return;
  }

  store.dispatch(appActions.popUndo());
  // Swap `from` and `to` to go backwards. `from` can be null (the row had no
  // edit before), in which case we put the row back to its source value.
  const reverted: EditOp[] = ops.map((op) => ({
    rowId: op.rowId,
    from: op.to,
    to: op.from ?? sourceCalls(op.rowId),
  }));
  store.dispatch(appActions.applyOps({ ops: reverted, fromUndo: true }));

  afterHistory(ops, 'Undid');
}

/**
 * FR-6: redo.
 *
 * Redo DOES re-validate, unlike undo. Redo is the user asking to make the
 * change again, and the cap of 60 is a business rule that a real server could
 * have changed in the meantime, so it seems wrong to just assume it still
 * passes. The downside is redo can fail, which is why it's async and why
 * there's a `historyBusy` flag stopping two from overlapping.
 */
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

/**
 * After an undo or redo, try to show the user what changed.
 *
 * Three cases:
 *  - the row is on screen: scroll to it and flash it
 *  - it's inside a collapsed group: open the group first
 *  - the filter is hiding it: the change still happened, but I show a message
 *    with a button instead of clearing the filter myself. Wiping out someone's
 *    search because they pressed undo felt too pushy.
 */
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

/** The button on the "hidden by the filter" message. */
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
