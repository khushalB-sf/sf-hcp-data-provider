import { formatCpi } from '../lib/cpi.ts';
import { useAppSelector } from '../store/store.ts';

interface Props {
  renderedRows: number;
  totalRows: number;
  matchCount: number;
  grandCalls: number;
  grandTrx: number;
}

export function Footer({ renderedRows, totalRows, matchCount, grandCalls, grandTrx }: Props) {
  const pending = useAppSelector((s) => s.app.pendingCount);
  const stale = useAppSelector((s) => s.app.staleReplies);

  return (
    <div className="footer">
      <span className="num">
        rows in DOM: <strong>{renderedRows}</strong> of {totalRows.toLocaleString()}
      </span>
      <span className="num">matching rows: {matchCount.toLocaleString()}</span>
      <span className="num">
        total Calls {Math.round(grandCalls).toLocaleString()} · total TRx{' '}
        {grandTrx.toLocaleString()} · CPI{' '}
        {formatCpi(grandTrx === 0 ? undefined : (grandCalls / grandTrx) * 100)}
      </span>
      <span className="num">
        cells validating: <strong>{pending}</strong>
      </span>
      {stale > 0 ? (
        <span className="num" title="Replies that arrived too late and were ignored.">
          ignored late replies: {stale}
        </span>
      ) : null}
    </div>
  );
}
