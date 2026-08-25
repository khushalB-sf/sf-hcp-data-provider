import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList, type ListOnScrollProps } from 'react-window';
import type { RowId } from '../lib/data.ts';
import {
  COLUMNS,
  GUTTER_WIDTH,
  ROW_HEIGHT,
  TOTAL_WIDTH,
  buildRowModel,
  findVisualIndex,
  type VisualRow,
} from '../lib/rowModel.ts';
import { appActions } from '../store/appSlice.ts';
import { makeCallsOf } from '../store/selectors.ts';
import { useAppDispatch, useAppSelector } from '../store/store.ts';
import { DataRow } from './DataRow.tsx';
import { GroupRow } from './GroupRow.tsx';

interface Props {
  height: number;
  onStats: (renderedRows: number, totalRows: number, matchCount: number) => void;
  onCommit: (rowId: RowId, value: number) => void;
}

export function Grid({ height, onStats, onCommit }: Props) {
  const dispatch = useAppDispatch();
  const filters = useAppSelector((s) => s.app.filters);
  const sort = useAppSelector((s) => s.app.sort);
  const collapsed = useAppSelector((s) => s.app.collapsed);
  const edits = useAppSelector((s) => s.app.edits);
  const selectedArray = useAppSelector((s) => s.app.selected);
  const anchor = useAppSelector((s) => s.app.selectionAnchor);
  const revealRow = useAppSelector((s) => s.app.revealRow);

  const listRef = useRef<FixedSizeList>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [flashRow, setFlashRow] = useState<RowId | null>(null);

  const selected = useMemo(() => new Set(selectedArray), [selectedArray]);
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);

  const callsOf = useMemo(() => makeCallsOf(edits), [edits]);

  const model = useMemo(
    () => buildRowModel(filters, sort, collapsedSet, callsOf),
    [filters, sort, collapsedSet, callsOf],
  );

  const { visualRows } = model;

  const rowDataRef = useRef({ visualRows, selected, collapsedSet, flashRow, callsOf });
  rowDataRef.current = { visualRows, selected, collapsedSet, flashRow, callsOf };

  useEffect(() => {
    const visibleRows = Math.ceil(height / ROW_HEIGHT);
    onStats(Math.min(visibleRows + 2, visualRows.length), visualRows.length, model.matchCount);
  }, [height, visualRows.length, model.matchCount, onStats]);

  useEffect(() => {
    if (revealRow === null) return;
    const index = findVisualIndex(visualRows, revealRow.rowId);
    if (index >= 0) {
      listRef.current?.scrollToItem(index, 'center');
      setFlashRow(revealRow.rowId);
      const timer = setTimeout(() => setFlashRow(null), 1500);
      dispatch(appActions.clearReveal());
      return () => clearTimeout(timer);
    }
    dispatch(appActions.clearReveal());
    return undefined;
  }, [revealRow, visualRows, dispatch]);

  const handleSelect = useCallback(
    (rowId: RowId, shiftKey: boolean) => {
      if (!shiftKey || anchor === null) {
        dispatch(appActions.toggleRow(rowId));
        return;
      }
      // Shift-click: select every data row between the anchor and this one, in
      // the order they appear on screen right now.
      const rows = rowDataRef.current.visualRows;
      const from = findVisualIndex(rows, anchor);
      const to = findVisualIndex(rows, rowId);
      if (from < 0 || to < 0) {
        dispatch(appActions.toggleRow(rowId));
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      const inRange: RowId[] = [];
      for (let i = start; i <= end; i++) {
        const visual = rows[i]!;
        if (visual.kind === 'data') inRange.push(visual.rowId);
      }
      dispatch(appActions.selectRows({ rowIds: inRange, select: true }));
    },
    [anchor, dispatch],
  );

  function handleScroll(props: ListOnScrollProps): void {
    // react-window only handles vertical scrolling for us. The header sits
    // outside the scroll container so it doesn't scroll away vertically, which
    // means I have to move it sideways by hand or the columns drift apart.
    void props;
    const outer = listRef.current as unknown as { _outerRef?: HTMLDivElement } | null;
    const left = outer?._outerRef?.scrollLeft ?? 0;
    if (headerRef.current) headerRef.current.style.transform = `translateX(${-left}px)`;
  }

  const renderRow = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const { visualRows, selected, collapsedSet, flashRow, callsOf } = rowDataRef.current;
      const visual = visualRows[index] as VisualRow;
      const rowIndex = index + 2; // +1 for the header row, +1 because aria is 1-based

      if (visual.kind === 'data') {
        return (
          <div style={style}>
            <DataRow
              rowId={visual.rowId}
              rowIndex={rowIndex}
              selected={selected.has(visual.rowId)}
              revealed={flashRow === visual.rowId}
              calls={callsOf(visual.rowId)}
              onSelect={handleSelect}
              onCommit={onCommit}
            />
          </div>
        );
      }

      if (visual.kind === 'region') {
        return (
          <div style={style}>
            <GroupRow
              label={visual.label}
              level={1}
              totals={visual.totals}
              collapsed={collapsedSet.has(visual.key)}
              rowIndex={rowIndex}
              onToggle={() => dispatch(appActions.toggleGroup(visual.key))}
            />
          </div>
        );
      }

      const allSelected =
        visual.rowIds.length > 0 && visual.rowIds.every((id) => selected.has(id));

      return (
        <div style={style}>
          <GroupRow
            label={visual.label}
            level={2}
            totals={visual.totals}
            collapsed={collapsedSet.has(visual.key)}
            rowIndex={rowIndex}
            onToggle={() => dispatch(appActions.toggleGroup(visual.key))}
            allSelected={allSelected}
            onSelectAll={(select) => dispatch(appActions.selectRows({ rowIds: visual.rowIds, select }))}
          />
        </div>
      );
    },
    [dispatch, handleSelect, onCommit],
  );

  return (
    <div
      className="grid"
      role="treegrid"
      aria-label="HCP records"
      aria-rowcount={visualRows.length + 1}
      aria-colcount={COLUMNS.length + 1}
    >
      <div className="header-scroll">
        <div ref={headerRef} style={{ width: TOTAL_WIDTH }}>
          <div className="row header-row" role="row" aria-rowindex={1}>
            <div className="cell" style={{ width: GUTTER_WIDTH }} role="columnheader">
              Region / Territory / HCP
            </div>
            {COLUMNS.map((column) => {
              const active = sort?.column === column.id;
              return (
                <div
                  key={column.id}
                  className={`cell${column.numeric ? ' num' : ''}`}
                  role="columnheader"
                  aria-sort={
                    active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  style={{ width: column.width }}
                >
                  <button
                    type="button"
                    className="toggle"
                    style={{ width: '100%', justifyContent: column.numeric ? 'flex-end' : 'flex-start' }}
                    onClick={() => dispatch(appActions.cycleSort(column.id))}
                    title={`Sort by ${column.label}`}
                  >
                    {column.label}
                    {active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {visualRows.length === 0 ? (
        <div className="empty">No rows match the current search and filter.</div>
      ) : (
        <FixedSizeList
          ref={listRef}
          height={height}
          width="100%"
          itemCount={visualRows.length}
          itemSize={ROW_HEIGHT}
          itemKey={(index) => visualRows[index]!.key}
          overscanCount={2}
          onScroll={handleScroll}
          outerElementType="div"
        >
          {renderRow}
        </FixedSizeList>
      )}
    </div>
  );
}
