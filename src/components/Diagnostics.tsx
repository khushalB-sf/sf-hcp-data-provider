import type { ResolvedTheme } from '../lib/theme.ts';
import { useAppSelector } from '../store/store.ts';

/**
 * FR-8 asks for errors to be surfaced rather than swallowed.
 *
 * If a tenant config has a bad value, the app quietly uses the default — which
 * is the right behaviour, but it means nobody would ever find out the config
 * was broken. This panel lists exactly which fields were rejected.
 */
export function Diagnostics({ resolved }: { resolved: ResolvedTheme }) {
  const editCount = useAppSelector((s) => Object.keys(s.app.edits).length);
  const undoDepth = useAppSelector((s) => s.app.undoStack.length);
  const stale = useAppSelector((s) => s.app.staleReplies);

  return (
    <div className="panel">
      <strong>Theme: {resolved.theme.appName}</strong>
      {resolved.problems.length === 0 ? (
        <p className="muted">Every field in this tenant config was valid.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Value we were given</th>
              <th>What we used instead</th>
            </tr>
          </thead>
          <tbody>
            {resolved.problems.map((problem) => (
              <tr key={problem.field}>
                <td>{problem.field}</td>
                <td><code>{problem.value}</code></td>
                <td><code>{problem.usedInstead}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">
        edited cells: {editCount} · undo steps: {undoDepth} · ignored late replies: {stale}
      </p>
    </div>
  );
}
