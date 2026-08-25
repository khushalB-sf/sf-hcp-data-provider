/** Increases every time we send a request, so we can spot stale replies. */
let nextRequestId = 1;
export const takeRequestId = (): number => nextRequestId++;
export const __resetRequestIds = (): void => {
  nextRequestId = 1;
};
