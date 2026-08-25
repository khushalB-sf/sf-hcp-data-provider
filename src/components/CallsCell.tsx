import { useEffect, useRef } from 'react';
import type { RowId } from '../lib/data.ts';
import type { CellState } from '../store/types.ts';

interface Props {
  rowId: RowId;
  value: number;
  wasString: boolean;
  state: CellState | undefined;
  draft: string | null;
  width: number;
  onStartEdit: () => void;
  onDraftChange: (draft: string) => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
  onDismiss: () => void;
}

const ICONS = { pending: '⏳', saved: '✓', rejected: '✕' };

/**
 * FR-4: the editable Calls cell.
 *
 * Three visual states, and each one has an icon as well as a colour so it
 * still works if you can't tell the colours apart. A value put back by undo
 * renders as a plain, unbadged number — same as a cell nobody has touched.
 */
export function CallsCell(props: Props) {
  const { value, wasString, state, draft, width, onCommit, onCancel } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft !== null) inputRef.current?.select();
  }, [draft]);

  if (draft !== null) {
    return (
      <div className="cell num" style={{ width }} role="gridcell">
        <input
          ref={inputRef}
          className="cell-input"
          inputMode="numeric"
          aria-label="Calls"
          value={draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onBlur={onCancel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const parsed = Number(draft.trim());
              if (draft.trim() === '' || !Number.isFinite(parsed)) onCancel();
              else onCommit(Math.round(parsed));
            } else if (e.key === 'Escape') {
              onCancel();
            }
            e.stopPropagation();
          }}
        />
      </div>
    );
  }

  const locked = state?.status === 'pending';
  const shown = locked ? state.pendingValue : value;

  let visual: keyof typeof ICONS | null = null;
  if (state?.status === 'pending') visual = 'pending';
  else if (state?.status === 'saved' && !state.fromUndo) visual = 'saved';
  else if (state?.status === 'rejected') visual = 'rejected';

  let title: string | undefined;
  if (state?.status === 'rejected') {
    title = `Rejected: ${state.reason}. Tried ${state.attempted}, value put back to ${value}. Press Escape to dismiss.`;
  } else if (state?.status === 'pending') {
    title = `Checking ${state.pendingValue}… this cell is locked until it comes back.`;
  } else if (wasString) {
    title = `This value arrived as text ("${shown}"), not a number. Converted for sorting and totals.`;
  }

  return (
    <div
      className="cell num"
      style={{ width }}
      role="gridcell"
      tabIndex={0}
      title={title}
      aria-readonly={locked}
      onDoubleClick={() => !locked && props.onStartEdit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !locked) {
          e.preventDefault();
          props.onStartEdit();
        } else if (e.key === 'Escape' && state?.status === 'rejected') {
          props.onDismiss();
        }
      }}
    >
      <span className={visual ? `state ${visual}` : undefined}>
        {visual ? <span aria-hidden="true">{ICONS[visual]}</span> : null}
        <span className={wasString && state?.committed == null ? 'provenance' : undefined}>
          {Number.isFinite(shown) ? shown.toLocaleString() : '—'}
        </span>
      </span>
      {state?.status === 'rejected' ? (
        <span className="sr-only">Rejected: {state.reason}</span>
      ) : null}
    </div>
  );
}
