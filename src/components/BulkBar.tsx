import { bulkAdjust, cancelBulk } from '../store/actions.ts';
import { appActions } from '../store/appSlice.ts';
import { useAppDispatch, useAppSelector } from '../store/store.ts';
import type { SkipReason } from '../store/types.ts';

const SKIP_LABELS: Record<SkipReason, string> = {
  'no-change': 'value would not change',
  locked: 'already being validated',
  'not-a-number': 'value is not a number',
};

export function BulkBar() {
  const dispatch = useAppDispatch();
  const selectedCount = useAppSelector((s) => s.app.selected.length);
  const progress = useAppSelector((s) => s.app.bulkProgress);
  const result = useAppSelector((s) => s.app.bulkResult);
  const filterActive = useAppSelector(
    (s) => s.app.filters.search !== '' || s.app.filters.region !== null,
  );

  if (progress !== null) {
    return (
      <div className="bar">
        <strong>{progress.label}</strong>
        <span className="num">
          {progress.done} / {progress.total} done
        </span>
        <button type="button" className="btn" onClick={cancelBulk}>
          Cancel
        </button>
        <span className="muted">
          Cancelling stops sending new requests. Rows already sent will still come back, and
          their answers are ignored.
        </span>
      </div>
    );
  }

  if (result !== null) {
    const addsUp = result.applied + result.rejected + result.skipped === result.selected;
    return (
      <div className="bar">
        <strong>{result.label}</strong>
        <span className="num">
          {result.applied} applied · {result.rejected} rejected · {result.skipped} skipped{' '}
          <span className="muted">of {result.selected} selected</span>
        </span>
        {!addsUp ? <span className="chip">numbers do not add up — bug</span> : null}
        {result.reasons.map((r) => (
          <span key={r.reason} className="chip" title={r.reason}>
            {r.count} × {r.reason}
          </span>
        ))}
        {result.skipReasons.map((r) => (
          <span key={r.reason} className="chip muted">
            {r.count} × {SKIP_LABELS[r.reason]}
          </span>
        ))}
        {result.hidden > 0 ? (
          <span className="chip">{result.hidden} changed rows are hidden by the filter</span>
        ) : null}
        <button type="button" className="btn" onClick={() => dispatch(appActions.setBulkResult(null))}>
          Dismiss
        </button>
      </div>
    );
  }

  if (selectedCount === 0) return null;

  return (
    <div className="bar">
      <strong className="num">{selectedCount.toLocaleString()} selected</strong>
      <button type="button" className="btn btn-primary" onClick={() => void bulkAdjust(10)}>
        +10% Calls
      </button>
      <button type="button" className="btn" onClick={() => void bulkAdjust(-10)}>
        −10% Calls
      </button>
      <button type="button" className="btn" onClick={() => dispatch(appActions.clearSelection())}>
        Clear selection
      </button>
      {filterActive ? (
        <span
          className="chip"
          title="A filter is on, so some selected rows may be off screen. The change still applies to all of them — the report says how many were hidden."
        >
          filter is on
        </span>
      ) : null}
    </div>
  );
}
