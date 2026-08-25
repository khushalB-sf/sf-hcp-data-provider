import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import { createLogger } from 'redux-logger';
import type { RowId } from '../lib/data.ts';
import { appActions, appReducer } from './appSlice.ts';
import { __resetRequestIds } from './requestIds.ts';

export const store = configureStore({
  reducer: { app: appReducer },
  middleware: (getDefaultMiddleware) =>
    import.meta.env.DEV && !import.meta.env.VITEST
      ? getDefaultMiddleware().concat(createLogger({ collapsed: true }))
      : getDefaultMiddleware(),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/** Reset everything between tests. */
export function resetStore(): void {
  __resetRequestIds();
  store.dispatch(appActions.resetAll());
}

export function markSaved(rowId: RowId, requestId: number): boolean {
  const edit = store.getState().app.edits[rowId];
  if (edit?.status !== 'pending' || edit.requestId !== requestId) return false;
  store.dispatch(appActions.markSaved({ rowId, value: edit.pendingValue }));
  return true;
}

export function markRejected(rowId: RowId, requestId: number, reason: string): boolean {
  const edit = store.getState().app.edits[rowId];
  if (edit?.status !== 'pending' || edit.requestId !== requestId) return false;
  store.dispatch(
    appActions.markRejected({ rowId, committed: edit.committed, attempted: edit.pendingValue, reason }),
  );
  return true;
}
