import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRows, toNumber } from '../lib/data.ts';
import { buildRowModel } from '../lib/rowModel.ts';
import { flush, installFakeValidator, type FakeValidator } from '../test/fakeValidator.ts';
import { bulkAdjust, commitCalls, percentOf } from './actions.ts';
import { appActions } from './appSlice.ts';
import { makeCallsOf } from './selectors.ts';
import { resetStore, store } from './store.ts';
import { resetValidator } from './validator.ts';

let validator: FakeValidator;
const ROW = 0;

/** The territory total for the group a row belongs to. */
function territoryCalls(rowId: number): number {
  const state = store.getState().app;
  const model = buildRowModel(
    state.filters,
    state.sort,
    new Set(state.collapsed),
    makeCallsOf(state.edits),
  );
  const row = getRows()[rowId]!;
  const groupRow = model.visualRows.find(
    (r) => r.kind === 'territory' && r.key === `territory:${row.region}||${row.territory}`,
  );
  if (groupRow?.kind !== 'territory') throw new Error('territory not found');
  return groupRow.totals.calls;
}

beforeEach(() => {
  resetStore();
  validator = installFakeValidator();
});

afterEach(() => {
  resetValidator();
});

describe('editing one cell (FR-4)', () => {
  it('goes pending, then saved, and the total moves once', async () => {
    const before = territoryCalls(ROW);
    const source = toNumber(getRows()[ROW]!.calls);
    const target = source + 5;

    const promise = commitCalls(ROW, target);
    await flush();

    expect(store.getState().app.edits[ROW]!.status).toBe('pending');
    // While it's still being checked the total must NOT include it.
    expect(territoryCalls(ROW)).toBe(before);

    validator.settle(0, 'ok');
    await promise;

    const cell = store.getState().app.edits[ROW]!;
    expect(cell.status).toBe('saved');
    expect(cell.committed).toBe(target);
    expect(territoryCalls(ROW)).toBe(before + 5);
    expect(store.getState().app.undoStack).toHaveLength(1);
  });

  it('puts the value back when the validator says no, and adds nothing to undo', async () => {
    const before = territoryCalls(ROW);

    const promise = commitCalls(ROW, 999);
    await flush();
    validator.settle(0, 'exceeds per-HCP call cap (60)');
    await promise;

    const cell = store.getState().app.edits[ROW]!;
    expect(cell.status).toBe('rejected');
    if (cell.status !== 'rejected') throw new Error('wrong status');
    expect(cell.reason).toBe('exceeds per-HCP call cap (60)');
    expect(cell.attempted).toBe(999);
    expect(territoryCalls(ROW)).toBe(before);
    // A rejected edit isn't a change, so there's nothing to undo.
    expect(store.getState().app.undoStack).toHaveLength(0);
  });

  it('refuses a second edit while the first is still being checked', async () => {
    const promise = commitCalls(ROW, 11);
    await flush();
    expect(validator.calls).toHaveLength(1);

    await commitCalls(ROW, 12);
    expect(validator.calls).toHaveLength(1); // refused, not queued

    validator.settle(0, 'ok');
    await promise;
    expect(store.getState().app.edits[ROW]!.committed).toBe(11);
  });

  it('does not call the validator if the value has not changed', async () => {
    const source = toNumber(getRows()[ROW]!.calls);
    await commitCalls(ROW, source);
    expect(validator.calls).toHaveLength(0);
    expect(store.getState().app.edits[ROW]).toBeUndefined();
  });

  it('editing one row does not touch the other row with the same id', async () => {
    // 9972 and 9973 share an id but are different HCPs.
    expect(getRows()[9972]!.id).toBe(getRows()[9973]!.id);

    const promise = commitCalls(9973, 12);
    await flush();
    validator.settle(0, 'ok');
    await promise;

    expect(store.getState().app.edits[9973]!.committed).toBe(12);
    expect(store.getState().app.edits[9972]).toBeUndefined();
  });
});

describe('bulk edit (FR-5)', () => {
  it('reports applied + rejected + skipped adding up to the selection', async () => {
    const rowIds = [...Array(30).keys()];
    store.dispatch(appActions.selectRows({ rowIds, select: true }));

    const promise = bulkAdjust(10);
    await flush();

    // Reject every third one, accept the rest.
    validator.settleAll((_value, index) =>
      index % 3 === 0 ? 'validation service 503 (simulated)' : 'ok',
    );
    await promise;

    const result = store.getState().app.bulkResult!;
    expect(result.applied + result.rejected + result.skipped).toBe(result.selected);
    expect(result.selected).toBe(30);
    expect(result.applied).toBeGreaterThan(0);
    expect(result.rejected).toBeGreaterThan(0);
  });

  it('makes exactly one undo entry, holding only the rows that worked', async () => {
    const rowIds = [...Array(20).keys()];
    store.dispatch(appActions.selectRows({ rowIds, select: true }));

    const promise = bulkAdjust(10);
    await flush();
    validator.settleAll((_value, index) => (index % 4 === 0 ? 'nope' : 'ok'));
    await promise;

    const history = store.getState().app.undoStack;
    expect(history).toHaveLength(1);
    expect(history[0]!.kind).toBe('bulk');
    if (history[0]!.kind !== 'bulk') throw new Error('wrong kind');
    expect(history[0]!.ops).toHaveLength(store.getState().app.bulkResult!.applied);
  });

  it('adds no undo entry at all when everything is rejected', async () => {
    store.dispatch(appActions.selectRows({ rowIds: [...Array(10).keys()], select: true }));
    const promise = bulkAdjust(10);
    await flush();
    validator.settleAll(() => 'exceeds per-HCP call cap (60)');
    await promise;

    expect(store.getState().app.bulkResult!.applied).toBe(0);
    expect(store.getState().app.undoStack).toHaveLength(0);
  });

  it('skips rows where +10% would not actually change anything', async () => {
    // Rounding means 0,1,2,3,4 stay the same at +10%.
    for (const value of [0, 1, 2, 3, 4]) expect(percentOf(value, 10)).toBe(value);
    for (const value of [5, 10, 40]) expect(percentOf(value, 10)).toBeGreaterThan(value);

    const rows = getRows();
    const smallRows: number[] = [];
    for (let i = 0; i < rows.length && smallRows.length < 5; i++) {
      if (toNumber(rows[i]!.calls) <= 4) smallRows.push(i);
    }
    expect(smallRows.length).toBeGreaterThan(0);

    store.dispatch(appActions.selectRows({ rowIds: smallRows, select: true }));
    const promise = bulkAdjust(10);
    await flush();
    validator.settleAll(() => 'ok');
    await promise;

    const result = store.getState().app.bulkResult!;
    expect(result.skipped).toBe(smallRows.length);
    expect(validator.calls).toHaveLength(0); // nothing was even sent
    expect(result.skipReasons.find((r) => r.reason === 'no-change')?.count).toBe(
      smallRows.length,
    );
  });
});
