import { validateCalls as realValidateCalls } from '../vendor/mock-validator.ts';

/**
 * A thin wrapper around the provided validator.
 *
 * The real one waits 300-900ms and fails 10% of the time at random. That's fine
 * for the app but impossible to test against, so tests swap in a fake one that
 * I can resolve or reject on demand. Everything else in the app calls
 * `validate()` and doesn't know the difference.
 */
export type Validator = (value: number) => Promise<void>;

let validator: Validator = realValidateCalls;

export function validate(value: number): Promise<void> {
  return validator(value);
}

export function setValidator(next: Validator): void {
  validator = next;
}

export function resetValidator(): void {
  validator = realValidateCalls;
}

/** The validator rejects with a plain string, not an Error. */
export function reasonOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'validation failed';
}
