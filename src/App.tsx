import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { BulkBar } from './components/BulkBar.tsx';
import { Diagnostics } from './components/Diagnostics.tsx';
import { Footer } from './components/Footer.tsx';
import { Grid } from './components/Grid.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import type { RowId } from './lib/data.ts';
import { buildRowModel } from './lib/rowModel.ts';
import { applyTheme, resolveTheme } from './lib/theme.ts';
import { appActions } from './store/appSlice.ts';
import { commitCalls } from './store/actions.ts';
import { clearFilterAndShow, redo, undo } from './store/history.ts';
import { makeCallsOf } from './store/selectors.ts';
import { useAppDispatch, useAppSelector } from './store/store.ts';

function initialTenant(): string {
  if (typeof window === 'undefined') return 'aurelia';
  return new URLSearchParams(window.location.search).get('tenant') ?? 'aurelia';
}

export function App() {
  const [tenant, setTenant] = useState(initialTenant);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [stats, setStats] = useState({ rendered: 0, total: 0, matches: 0 });
  const [gridHeight, setGridHeight] = useState(600);

  const dispatch = useAppDispatch();
  const message = useAppSelector((s) => s.app.message);
  const notice = useAppSelector((s) => s.app.hiddenNotice);
  const filters = useAppSelector((s) => s.app.filters);
  const sort = useAppSelector((s) => s.app.sort);
  const collapsed = useAppSelector((s) => s.app.collapsed);
  const edits = useAppSelector((s) => s.app.edits);

  const resolved = useMemo(() => resolveTheme(tenant), [tenant]);

  useLayoutEffect(() => {
    applyTheme(resolved, document.documentElement);
  }, [resolved]);

  const totals = useMemo(() => {
    const model = buildRowModel(filters, sort, new Set(collapsed), makeCallsOf(edits));
    return model.grandTotals;
  }, [filters, sort, collapsed, edits]);

  useEffect(() => {
    function measure(): void {
      setGridHeight(Math.max(200, window.innerHeight - 100));
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        void redo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onStats = useCallback((rendered: number, total: number, matches: number) => {
    setStats({ rendered, total, matches });
  }, []);

  const onCommit = useCallback((rowId: RowId, value: number) => {
    void commitCalls(rowId, value);
  }, []);

  function changeTenant(next: string): void {
    setTenant(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tenant', next);
    window.history.replaceState(null, '', url.toString());
  }

  return (
    <div className="app">
      <Toolbar
        resolved={resolved}
        tenant={tenant}
        onTenantChange={changeTenant}
        showDiagnostics={showDiagnostics}
        onToggleDiagnostics={() => setShowDiagnostics((v) => !v)}
      />

      <BulkBar />

      {notice !== null ? (
        <div className="bar notice" role="status">
          <span>{notice.text}</span>
          <button
            type="button"
            className="btn"
            onClick={() => clearFilterAndShow(notice.rowId)}
          >
            Clear filter and show me
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => dispatch(appActions.setHiddenNotice(null))}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <Grid
        height={gridHeight}
        onStats={onStats}
        onCommit={onCommit}
      />

      <Footer
        renderedRows={stats.rendered}
        totalRows={stats.total}
        matchCount={stats.matches}
        grandCalls={totals.calls}
        grandTrx={totals.trx}
      />

      {showDiagnostics ? <Diagnostics resolved={resolved} /> : null}

      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
