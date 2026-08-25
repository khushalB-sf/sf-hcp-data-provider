import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRows, toNumber } from '../lib/data.ts';
import { buildRowModel, type Filters } from '../lib/rowModel.ts';
import { flush, installFakeValidator, type FakeValidator } from '../test/fakeValidator.ts';
import { bulkAdjust, commitCalls } from './actions.ts';
import { HISTORY_LIMIT, appActions } from './appSlice.ts';
import { redo, undo } from './history.ts';
import { makeCallsOf, selectCallsOf, selectIsLocked } from './selectors.ts';
import { resetStore, store } from './store.ts';
import { resetValidator } from './validator.ts';

let validator: FakeValidator;
const ROW = 5;

/** Do one successful edit and return what the value was before it. */
async function editOnce(rowId: number, value: number, callIndex: number): Promise<number> {
  const before = selectCallsOf(store.getState().app, rowId);
  const promise = commitCalls(rowId, value);
  await flush();
  validator.settle(callIndex, 'ok');
  await promise;
  return before;
}

beforeEach(() => {
  resetStore();
  validator = installFakeValidator();
});

afterEach(() => {
  resetValidator();
});

describe('undo and redo (FR-4, FR-6)', () => {
  it('undo puts the value back and moves the entry to the redo stack', async () => {
    const before = await editOnce(ROW, 33, 0);
    expect(selectCallsOf(store.getState().app, ROW)).toBe(33);

    undo();
    expect(selectCallsOf(store.getState().app, ROW)).toBe(before);
    expect(store.getState().app.undoStack).toHaveLength(0);
    expect(store.getState().app.redoStack).toHaveLength(1);
  });

  it('undo does NOT call the validator', async () => {
    await editOnce(ROW, 33, 0);
    const callsBefore = validator.calls.length;

    undo();
    await flush();
    // Undo is putting back a value the validator already accepted, and the real
    // validator fails 10% of the time — so re-checking could leave the user
    // stuck. It has to just work.
    expect(validator.calls).toHaveLength(callsBefore);
  });

  it('marks an undone cell as changed-not-checked rather than saved', async () => {
    await editOnce(ROW, 33, 0);
    expect(store.getState().app.edits[ROW]).toMatchObject({ status: 'saved', fromUndo: false });

    undo();
    // Different marker, because this value never went through the validator.
    expect(store.getState().app.edits[ROW]).toMatchObject({ status: 'saved', fromUndo: true });
  });

  it('redo DOES call the validator, and can be rejected', async () => {
    await editOnce(ROW, 33, 0);
    undo();

    const promise = redo();
    await flush();
    expect(validator.calls).toHaveLength(2); // it really did re-check

    validator.settle(1, 'validation service 503 (simulated)');
    await promise;

    expect(store.getState().app.edits[ROW]!.status).toBe('rejected');
    expect(store.getState().app.undoStack).toHaveLength(0);
    expect(store.getState().app.redoStack).toHaveLength(0); // cleared after a failed redo
  });

  it('redo succeeds and puts the entry back on the undo stack', async () => {
    await editOnce(ROW, 33, 0);
    undo();

    const promise = redo();
    await flush();
    validator.settle(1, 'ok');
    await promise;

    expect(selectCallsOf(store.getState().app, ROW)).toBe(33);
    expect(store.getState().app.undoStack).toHaveLength(1);
    expect(store.getState().app.redoStack).toHaveLength(0);
  });

  it('doing something new clears the redo stack', async () => {
    await editOnce(ROW, 33, 0);
    undo();
    expect(store.getState().app.redoStack).toHaveLength(1);

    await editOnce(ROW, 21, 1);
    expect(store.getState().app.redoStack).toHaveLength(0);
  });

  it('refuses to undo a row that is still being validated', async () => {
    await editOnce(ROW, 33, 0);

    // Start a second edit but don't let it finish.
    const pending = commitCalls(ROW, 44);
    await flush();
    expect(selectIsLocked(store.getState().app, ROW)).toBe(true);

    undo();
    // The entry is still there — we didn't throw it away, so the user can retry.
    expect(store.getState().app.undoStack).toHaveLength(1);

    validator.settle(1, 'ok');
    await pending;
  });

  it('clears a rejected badge on undo, even with nothing to undo', async () => {
    const promise = commitCalls(ROW, 999);
    await flush();
    validator.settle(0, 'exceeds per-HCP call cap (60)');
    await promise;
    expect(store.getState().app.edits[ROW]!.status).toBe('rejected');

    undo();
    expect(store.getState().app.edits[ROW]).toBeUndefined();
  });

  it('stops the undo stack growing forever', async () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      store.dispatch(
        appActions.pushCommand({
          kind: 'single',
          op: { rowId: i, from: null, to: i + 1 },
        }),
      );
    }
    expect(store.getState().app.undoStack).toHaveLength(HISTORY_LIMIT);
  });
});

/**
 * These are the tests for "must behave correctly regardless of the current
 * sort, filter, or grouping state" — which is the part of FR-4 I found most
 * interesting, because it's really a question about what an undo entry points
 * at. Mine points at the row's index in the source array, and sorting/filtering
 * never change that array.
 */
describe('undo works whatever the grid is currently showing', () => {
  it('still undoes the right row after the grid is sorted', async () => {
    const before = await editOnce(ROW, 33, 0);

    // Sort by something completely different, which reorders everything.
    store.dispatch(appActions.cycleSort('name'));
    expect(store.getState().app.sort).toEqual({ column: 'name', dir: 'asc' });

    undo();
    expect(selectCallsOf(store.getState().app, ROW)).toBe(before);
  });

  it('still undoes the right row after the group is collapsed', async () => {
    const before = await editOnce(ROW, 33, 0);
    const row = getRows()[ROW]!;

    store.dispatch(appActions.toggleGroup(`region:${row.region}`));
    const model = buildRowModel(
      store.getState().app.filters,
      null,
      new Set(store.getState().app.collapsed),
      makeCallsOf(store.getState().app.edits),
    );
    // The row isn't in the visible list any more.
    expect(model.visualRows.some((r) => r.kind === 'data' && r.rowId === ROW)).toBe(false);

    undo();
    expect(selectCallsOf(store.getState().app, ROW)).toBe(before);
    // And the group gets opened so the user can see what changed.
    expect(store.getState().app.collapsed.includes(`region:${row.region}`)).toBe(false);
  });

  it('still changes the row when the filter is hiding it, and says so', async () => {
    const before = await editOnce(ROW, 33, 0);
    const row = getRows()[ROW]!;

    // Filter to a different region, so our row is hidden.
    const otherRegion = getRows().find((r) => r.region !== row.region)!.region;
    store.dispatch(appActions.setRegion(otherRegion));

    undo();

    // The change still happened — data is data, whatever the view is showing.
    expect(selectCallsOf(store.getState().app, ROW)).toBe(before);
    // But we tell the user rather than silently doing nothing.
    expect(store.getState().app.hiddenNotice).not.toBeNull();
    expect(store.getState().app.hiddenNotice!.rowId).toBe(ROW);
    // And we do NOT clear their filter for them.
    expect(store.getState().app.filters.region).toBe(otherRegion);
  });

  it('asks the grid to scroll to the row it changed', async () => {
    await editOnce(ROW, 33, 0);
    undo();
    expect(store.getState().app.revealRow?.rowId).toBe(ROW);
  });

  it('an undo entry stores the change, not a copy of the data', async () => {
    await editOnce(ROW, 33, 0);
    const entry = store.getState().app.undoStack[0]!;
    if (entry.kind !== 'single') throw new Error('wrong kind');

    // Just three fields. A snapshot of 50,000 rows per step would be huge, and
    // restoring one would also undo the user's sorting, which isn't what they
    // asked for.
    expect(Object.keys(entry.op).sort()).toEqual(['from', 'rowId', 'to']);
    expect(entry.op.rowId).toBe(ROW);
    expect(entry.op.to).toBe(33);
    expect(entry.op.from).toBeNull(); // there was no previous edit
  });

  it('undoing back to a row that had no edit clears the edit entirely', async () => {
    const source = toNumber(getRows()[ROW]!.calls);
    await editOnce(ROW, source + 3, 0);
    undo();
    expect(selectCallsOf(store.getState().app, ROW)).toBe(source);
  });
});

describe('undoing a whole bulk edit at once (FR-6)', () => {
  it('one undo puts back every row the bulk edit changed', async () => {
    const rowIds = [...Array(15).keys()];
    const noFilters: Filters = { search: '', region: null };
    const totalOf = () => {
      const model = buildRowModel(noFilters, null, new Set(), makeCallsOf(store.getState().app.edits));
      return model.grandTotals.calls;
    };

    const before = totalOf();
    store.dispatch(appActions.selectRows({ rowIds, select: true }));

    const promise = bulkAdjust(10);
    await flush();
    validator.settleAll(() => 'ok');
    await promise;

    expect(totalOf()).toBeGreaterThan(before);
    expect(store.getState().app.undoStack).toHaveLength(1);

    // A single undo, not fifteen.
    undo();
    expect(totalOf()).toBeCloseTo(before, 5);
    expect(store.getState().app.undoStack).toHaveLength(0);
    expect(store.getState().app.redoStack).toHaveLength(1);
  });
});
