import { useEffect, useState } from 'react';
import { getGroupIndex } from '../lib/data.ts';
import { TENANT_KEYS, type ResolvedTheme } from '../lib/theme.ts';
import { appActions } from '../store/appSlice.ts';
import { redo, undo } from '../store/history.ts';
import { useAppDispatch, useAppSelector } from '../store/store.ts';

interface Props {
  resolved: ResolvedTheme;
  tenant: string;
  onTenantChange: (tenant: string) => void;
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
}

const SEARCH_DELAY_MS = 200;

export function Toolbar({
  resolved,
  tenant,
  onTenantChange,
  showDiagnostics,
  onToggleDiagnostics,
}: Props) {
  const dispatch = useAppDispatch();
  const region = useAppSelector((s) => s.app.filters.region);
  const collapsedCount = useAppSelector((s) => s.app.collapsed.length);
  const undoDepth = useAppSelector((s) => s.app.undoStack.length);
  const redoDepth = useAppSelector((s) => s.app.redoStack.length);
  const busy = useAppSelector((s) => s.app.historyBusy);

  const [text, setText] = useState('');
  const index = getGroupIndex();

  /**
   * The input keeps its own value and only tells the store after a pause, so
   * typing doesn't have to wait for 50,000 rows to be filtered on every letter.
   */
  useEffect(() => {
    const timer = setTimeout(() => dispatch(appActions.setSearch(text)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, dispatch]);

  function collapseAll(): void {
    const keys: string[] = [];
    for (const regionName of index.regions) {
      keys.push(`region:${regionName}`);
      for (const key of index.territoriesByRegion.get(regionName)!) {
        keys.push(`territory:${key}`);
      }
    }
    dispatch(appActions.setCollapsed(keys));
  }

  return (
    <div className="toolbar">
      <span className="title">{resolved.theme.appName}</span>

      <input
        className="field"
        style={{ width: 220 }}
        placeholder="Search name or ID…"
        aria-label="Search by name or ID"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <select
        className="field"
        aria-label="Filter by region"
        value={region ?? ''}
        onChange={(e) => dispatch(appActions.setRegion(e.target.value === '' ? null : e.target.value))}
      >
        <option value="">All regions</option>
        {index.regions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="btn"
        disabled={undoDepth === 0 || busy}
        onClick={undo}
        title="Undo (Ctrl/Cmd+Z). Puts values back without re-checking them."
      >
        Undo{undoDepth > 0 ? ` (${undoDepth})` : ''}
      </button>
      <button
        type="button"
        className="btn"
        disabled={redoDepth === 0 || busy}
        onClick={() => void redo()}
        title="Redo (Ctrl/Cmd+Shift+Z). Re-checks with the validator, so it can fail."
      >
        Redo{redoDepth > 0 ? ` (${redoDepth})` : ''}
      </button>

      <button type="button" className="btn" onClick={collapseAll}>
        Collapse all
      </button>
      <button
        type="button"
        className="btn"
        disabled={collapsedCount === 0}
        onClick={() => dispatch(appActions.setCollapsed([]))}
      >
        Expand all
      </button>

      <span className="spacer" />

      <label className="gutter">
        <span className="muted">Tenant</span>
        <select
          className="field"
          aria-label="Tenant theme"
          value={tenant}
          onChange={(e) => onTenantChange(e.target.value)}
        >
          {TENANT_KEYS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
          <option value="unknown-tenant">unknown-tenant</option>
        </select>
      </label>

      <button type="button" className="btn" onClick={onToggleDiagnostics}>
        {showDiagnostics ? 'Hide' : 'Show'} diagnostics
        {resolved.problems.length > 0 ? ` (${resolved.problems.length})` : ''}
      </button>
    </div>
  );
}
