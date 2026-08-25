import { formatCpi, formatCpiExact, isCpiClamped } from '../lib/cpi.ts';
import { COLUMNS, GUTTER_WIDTH, totalsCpi, type Totals } from '../lib/rowModel.ts';

interface Props {
  label: string;
  level: 1 | 2;
  totals: Totals;
  collapsed: boolean;
  rowIndex: number;
  onToggle: () => void;
  /** Territory rows only. */
  allSelected?: boolean;
  onSelectAll?: (select: boolean) => void;
}

/**
 * FR-2: a region or territory header, with its totals.
 *
 * The totals show even when the group is collapsed, which is the point of the
 * requirement — a collapsed group that hides its own numbers isn't much use.
 *
 * The totals come from the same value the cells show (`committed ?? source`),
 * so an edit that's still being validated isn't counted here.
 */
export function GroupRow({
  label,
  level,
  totals,
  collapsed,
  rowIndex,
  onToggle,
  allSelected,
  onSelectAll,
}: Props) {
  const groupCpi = totalsCpi(totals);

  return (
    <div
      className={`row ${level === 1 ? 'region-row' : 'territory-row'}`}
      role="row"
      aria-rowindex={rowIndex}
      aria-level={level}
      aria-expanded={!collapsed}
    >
      <div
        className="cell gutter"
        style={{ width: GUTTER_WIDTH, paddingLeft: 8 + (level - 1) * 16 }}
        role="gridcell"
      >
        {onSelectAll ? (
          <input
            type="checkbox"
            checked={allSelected === true}
            aria-label={`Select every visible row in ${label}`}
            onChange={(e) => onSelectAll(e.target.checked)}
          />
        ) : (
          <span style={{ width: 13, display: 'inline-block' }} />
        )}
        <button
          type="button"
          className="toggle"
          onClick={onToggle}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          <span aria-hidden="true" style={{ width: 10 }}>
            {collapsed ? '▸' : '▾'}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        </button>
        <span className="muted num" style={{ fontWeight: 400 }}>
          ({totals.count.toLocaleString()} HCPs)
        </span>
      </div>

      {COLUMNS.map((column) => {
        if (!column.numeric) {
          return <div key={column.id} className="cell" style={{ width: column.width }} role="gridcell" />;
        }

        if (column.id === 'cpi') {
          return (
            <div
              key={column.id}
              className="cell num"
              style={{ width: column.width }}
              role="gridcell"
              title={isCpiClamped(groupCpi) ? formatCpiExact(groupCpi) : undefined}
            >
              {formatCpi(groupCpi)}
            </div>
          );
        }

        const value = totals[column.id as 'calls' | 'trx' | 'nrx'];
        return (
          <div key={column.id} className="cell num" style={{ width: column.width }} role="gridcell">
            {value.toLocaleString()}
            {column.id === 'calls' && totals.overCap > 0 ? (
              <span
                className="chip"
                style={{ marginLeft: 4 }}
                title={`${totals.overCap} row(s) here have Calls above the validator's cap of 60 — including the 99999 values that look like placeholders. They are still counted in the total.`}
              >
                !{totals.overCap}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
