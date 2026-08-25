import { getRows, type RowId } from '../lib/data.ts';
import { appActions } from './appSlice.ts';
import { takeRequestId } from './requestIds.ts';
import { selectCallsOf, selectIsLocked } from './selectors.ts';
import { markRejected, markSaved, store } from './store.ts';
import type { EditOp, SkipReason } from './types.ts';
import { reasonOf, validate } from './validator.ts';

/**
 * FR-4: commit one cell edit.
 *
 * Order matters here. The cell is marked pending BEFORE the request goes out,
 * so it's locked for the whole time the request is in flight. If I did it the
 * other way round there'd be a gap where a second edit could slip through.
 */
export async function commitCalls(rowId: RowId, value: number): Promise<void> {
  const state = store.getState().app;

  // A cell that's already validating doesn't accept another edit. I don't queue
  // it either: with 300-900ms of latency you'd end up with a chain of edits and
  // no clear answer about what the final value should be if one of them fails.
  if (selectIsLocked(state, rowId)) {
    store.dispatch(appActions.say('That cell is still validating — please wait.'));
    return;
  }

  const current = selectCallsOf(state, rowId);
  if (value === current) {
    store.dispatch(appActions.stopEditing());
    return; // nothing changed, so don't bother the validator
  }

  const from = state.edits[rowId]?.committed ?? null;
  const requestId = takeRequestId();
  store.dispatch(appActions.startPending({ rowId, value, requestId }));
  store.dispatch(appActions.stopEditing());

  try {
    await validate(value);
    if (!markSaved(rowId, requestId)) {
      store.dispatch(appActions.noteStaleReply());
      return;
    }
    store.dispatch(appActions.pushCommand({ kind: 'single', op: { rowId, from, to: value } }));
    store.dispatch(appActions.say(`Saved ${value} for ${getRows()[rowId]!.name}.`));
  } catch (error) {
    const reason = reasonOf(error);
    if (!markRejected(rowId, requestId, reason)) {
      store.dispatch(appActions.noteStaleReply());
      return;
    }
    // A rejected edit is not a change, so it does NOT go on the undo stack.
    store.dispatch(appActions.say(`Rejected: ${reason}. The value was put back.`));
  }
}

/** How many concurrent validator calls a bulk run is allowed to have going. */
export const BULK_CONCURRENCY = 100;

export const percentOf = (value: number, percent: number): number =>
  Math.round(value * (1 + percent / 100));

let cancelled = false;
export function cancelBulk(): void {
  cancelled = true;
  store.dispatch(appActions.say('Cancelling — rows already sent will finish on their own.'));
}

/**
 * FR-5: apply +/-10% to every selected row.
 *
 * Each row is validated on its own, so some can succeed while others fail. The
 * report has to add up: applied + rejected + skipped must equal how many rows
 * were selected, otherwise it looks like work went missing.
 */
export async function bulkAdjust(percent: number): Promise<void> {
  const state = store.getState().app;
  if (state.bulkProgress !== null) return;

  const selected = state.selected;
  if (selected.length === 0) {
    store.dispatch(appActions.say('Nothing is selected.'));
    return;
  }

  const label = `${percent > 0 ? '+' : ''}${percent}% Calls`;

  // Work out up front what we're actually going to send. Doing this first means
  // the numbers in the report are fixed before anything is in flight.
  const targets: { rowId: RowId; from: number | null; to: number }[] = [];
  const skipped: SkipReason[] = [];

  for (const rowId of selected) {
    if (selectIsLocked(state, rowId)) {
      skipped.push('locked');
      continue;
    }
    const current = selectCallsOf(state, rowId);
    if (!Number.isFinite(current)) {
      skipped.push('not-a-number');
      continue;
    }
    const next = percentOf(current, percent);
    // Surprise I hit while testing: round(v * 1.1) === v for v of 0,1,2,3,4.
    // That's about 11% of the dataset, so this bucket is not a rare edge case.
    if (next === current) {
      skipped.push('no-change');
      continue;
    }
    targets.push({ rowId, from: state.edits[rowId]?.committed ?? null, to: next });
  }

  cancelled = false;
  store.dispatch(appActions.setBulkResult(null));
  store.dispatch(appActions.setBulkProgress({ label, total: targets.length, done: 0 }));

  const applied: EditOp[] = [];
  const rejectCounts = new Map<string, number>();
  const abandoned: RowId[] = [];

  // Mark them all pending first, so nothing else can edit them mid-run.
  const requestIds = new Map<RowId, number>();
  for (const target of targets) {
    const requestId = takeRequestId();
    requestIds.set(target.rowId, requestId);
    store.dispatch(appActions.startPending({ rowId: target.rowId, value: target.to, requestId }));
  }

  async function runOne(target: (typeof targets)[number]): Promise<void> {
    const requestId = requestIds.get(target.rowId)!;
    try {
      await validate(target.to);
      if (!markSaved(target.rowId, requestId)) {
        store.dispatch(appActions.noteStaleReply());
        return;
      }
      applied.push({ rowId: target.rowId, from: target.from, to: target.to });
    } catch (error) {
      const reason = reasonOf(error);
      if (!markRejected(target.rowId, requestId, reason)) {
        store.dispatch(appActions.noteStaleReply());
        return;
      }
      rejectCounts.set(reason, (rejectCounts.get(reason) ?? 0) + 1);
    }
    store.dispatch(appActions.bumpBulkProgress());
  }

  // Run them in batches rather than all at once, so we don't fire 1,000
  // requests in the same tick.
  for (let i = 0; i < targets.length; i += BULK_CONCURRENCY) {
    if (cancelled) {
      for (let j = i; j < targets.length; j++) abandoned.push(targets[j]!.rowId);
      break;
    }
    await Promise.all(targets.slice(i, i + BULK_CONCURRENCY).map(runOne));
  }

  // If we cancelled, unlock anything we marked pending but never sent, plus
  // anything still in flight. Those requests will still come back later, and
  // the request-id check in markSaved/markRejected throws them away.
  for (const target of targets) {
    if (selectIsLocked(store.getState().app, target.rowId)) {
      store.dispatch(appActions.releasePending({ rowId: target.rowId }));
      if (!abandoned.includes(target.rowId)) abandoned.push(target.rowId);
    }
  }

  const skipCounts = new Map<SkipReason, number>();
  for (const reason of skipped) skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);

  const rejected = [...rejectCounts.values()].reduce((a, b) => a + b, 0);
  const skippedTotal = skipped.length + abandoned.length;

  const filters = store.getState().app.filters;
  let hidden = 0;
  if (filters.region !== null || filters.search !== '') {
    const rows = getRows();
    const needle = filters.search.trim().toLowerCase();
    for (const op of applied) {
      const row = rows[op.rowId]!;
      const matches =
        (filters.region === null || row.region === filters.region) &&
        (needle === '' ||
          row.name.toLowerCase().includes(needle) ||
          row.id.toLowerCase().includes(needle));
      if (!matches) hidden++;
    }
  }

  store.dispatch(appActions.setBulkProgress(null));
  store.dispatch(
    appActions.setBulkResult({
      label,
      applied: applied.length,
      rejected,
      skipped: skippedTotal,
      selected: selected.length,
      hidden,
      reasons: [...rejectCounts]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      skipReasons: [...skipCounts].map(([reason, count]) => ({ reason, count })),
    }),
  );

  // One undo entry for the whole operation, holding only the rows that worked.
  // If none worked there's no entry at all — an undo that does nothing would
  // just be confusing.
  if (applied.length > 0) {
    store.dispatch(appActions.pushCommand({ kind: 'bulk', label, ops: applied }));
  }

  store.dispatch(
    appActions.say(`${label}: ${applied.length} applied, ${rejected} rejected, ${skippedTotal} skipped.`),
  );
}
