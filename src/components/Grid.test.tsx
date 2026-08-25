import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appActions } from '../store/appSlice.ts';
import { resetStore, store } from '../store/store.ts';
import { resetValidator } from '../store/validator.ts';
import { Grid } from './Grid.tsx';

function renderGrid() {
  return render(
    <Provider store={store}>
      <Grid height={640} onStats={() => undefined} onCommit={() => undefined} />
    </Provider>,
  );
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetValidator();
});

describe('the grid on screen (FR-1)', () => {
  it('only puts a screenful of rows in the DOM, not 50,000', () => {
    renderGrid();
    const rows = document.querySelectorAll('.row');
    // 640px / 32px per row is 20 rows, plus overscan and the header.
    expect(rows.length).toBeLessThan(40);
    expect(rows.length).toBeGreaterThan(5);
  });

  it('tells screen readers the real total, not the number on screen', () => {
    renderGrid();
    const grid = screen.getByRole('treegrid');
    const rowCount = Number(grid.getAttribute('aria-rowcount'));
    // 50,000 rows + 6 region headers + 48 territory headers + 1 header row.
    expect(rowCount).toBeGreaterThan(50000);
  });

  it('shows group headers with their totals', () => {
    renderGrid();
    const groupRow = document.querySelector('.region-row');
    expect(groupRow).not.toBeNull();
    expect(groupRow!.textContent).toMatch(/HCPs/);
  });

  it('never renders NaN, Infinity or [object Object]', () => {
    renderGrid();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/NaN|Infinity|\[object Object\]/);
  });

  it('shows a message instead of an empty grid when nothing matches', () => {
    store.dispatch(appActions.setSearch('zzzz-definitely-not-a-name'));
    renderGrid();
    expect(screen.getByText(/No rows match/)).toBeTruthy();
  });

  it('marks the sorted column for screen readers', () => {
    store.dispatch(appActions.cycleSort('calls'));
    renderGrid();
    const headers = screen.getAllByRole('columnheader');
    const sorted = headers.find((h) => h.getAttribute('aria-sort') === 'ascending');
    expect(sorted).toBeTruthy();
    expect(sorted!.textContent).toContain('Calls');
  });
});
