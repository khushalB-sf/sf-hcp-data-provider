import { memo } from 'react';
import { getRows, wasString, type RowId } from '../lib/data.ts';
import { cpi, formatCpi, formatCpiExact, isCpiClamped } from '../lib/cpi.ts';
import { COLUMNS, GUTTER_WIDTH } from '../lib/rowModel.ts';
import { appActions } from '../store/appSlice.ts';
import { useAppDispatch, useAppSelector } from '../store/store.ts';
import { CallsCell } from './CallsCell.tsx';

interface Props {
  rowId: RowId;
  rowIndex: number;
  selected: boolean;
  revealed: boolean;
  calls: number;
  onSelect: (rowId: RowId, shiftKey: boolean) => void;
  /** Passed in rather than imported, so this component doesn't need to know
      how a commit actually happens. */
  onCommit: (rowId: RowId, value: number) => void;
}

/**
 * One HCP row.
 *
 * Wrapped in memo, and it only subscribes to its OWN edit state. Without that,
 * every row re-rendered whenever any cell anywhere finished validating, which
 * during a bulk edit meant a lot of wasted rendering.
 */
function DataRowInner({
  rowId,
  rowIndex,
  selected,
  revealed,
  calls,
  onSelect,
  onCommit,
}: Props) {
  const row = getRows()[rowId]!;
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.app.edits[rowId]);
  const draft = useAppSelector((s) => (s.app.editingRow === rowId ? s.app.editingDraft : null));

  const cpiValue = cpi(calls, row.trx);

  return (
    <div
      className={`row data-row${selected ? ' selected' : ''}${revealed ? ' revealed' : ''}`}
      role="row"
      aria-rowindex={rowIndex}
      aria-level={3}
      aria-selected={selected}
      data-rowid={rowId}
    >
      <div className="cell gutter" style={{ width: GUTTER_WIDTH, paddingLeft: 40 }} role="gridcell">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${row.name}`}
          onChange={() => undefined}
          onClick={(e) => onSelect(rowId, e.shiftKey)}
        />
        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.territory}
        </span>
      </div>

      {COLUMNS.map((column) => {
        const className = `cell${column.numeric ? ' num' : ''}`;

        if (column.id === 'calls') {
          return (
            <CallsCell
              key={column.id}
              rowId={rowId}
              value={calls}
              wasString={wasString(row)}
              state={state}
              draft={draft}
              width={column.width}
              onStartEdit={() => {
                if (state?.status === 'pending') {
                  dispatch(appActions.say('That cell is still validating — please wait.'));
                  return;
                }
                dispatch(
                  appActions.startEditing({
                    rowId,
                    draft: Number.isFinite(calls) ? String(calls) : '',
                  }),
                );
              }}
              onDraftChange={(draft) => dispatch(appActions.changeDraft(draft))}
              onCommit={(value) => onCommit(rowId, value)}
              onCancel={() => dispatch(appActions.stopEditing())}
              onDismiss={() => dispatch(appActions.dismissRejection({ rowId }))}
            />
          );
        }

        if (column.id === 'cpi') {
          return (
            <div
              key={column.id}
              className={className}
              style={{ width: column.width }}
              role="gridcell"
              title={
                cpiValue === undefined
                  ? 'TRx is 0, so CPI cannot be worked out.'
                  : isCpiClamped(cpiValue)
                    ? `Actual value: ${formatCpiExact(cpiValue)}`
                    : undefined
              }
            >
              {formatCpi(cpiValue)}
            </div>
          );
        }

        if (column.id === 'specialty') {
          return (
            <div key={column.id} className={className} style={{ width: column.width }} role="gridcell">
              {row.specialty === null ? (
                <span className="provenance" title="This row has no specialty in the source data.">
                  null
                </span>
              ) : (
                row.specialty
              )}
            </div>
          );
        }

        if (column.id === 'id') {
          return (
            <div
              key={column.id}
              className={className}
              style={{ width: column.width }}
              role="gridcell"
              title={`${row.id} — note this id is not unique in the dataset`}
            >
              {row.id}
            </div>
          );
        }

        if (column.id === 'name') {
          return (
            <div key={column.id} className={className} style={{ width: column.width }} role="gridcell">
              {row.name}
            </div>
          );
        }

        return (
          <div key={column.id} className={className} style={{ width: column.width }} role="gridcell">
            {row[column.id as 'trx' | 'nrx'].toLocaleString()}
          </div>
        );
      })}
    </div>
  );
}

export const DataRow = memo(DataRowInner);
