import { setValidator } from '../store/validator.ts';

export interface FakeValidator {
  calls: { value: number }[];
  settle: (index: number, outcome: 'ok' | string) => void;
  settleAll: (outcome: (value: number, index: number) => 'ok' | string) => void;
}

export function installFakeValidator(): FakeValidator {
  const calls: { value: number }[] = [];
  const resolvers: { resolve: () => void; reject: (reason: string) => void }[] = [];
  const done = new Set<number>();

  setValidator((value) => {
    calls.push({ value });
    return new Promise<void>((resolve, reject) => {
      resolvers.push({ resolve, reject });
    });
  });

  return {
    calls,
    settle(index, outcome) {
      const resolver = resolvers[index];
      if (resolver === undefined || done.has(index)) return;
      done.add(index);
      if (outcome === 'ok') resolver.resolve();
      else resolver.reject(outcome);
    },
    settleAll(outcome) {
      for (let i = 0; i < resolvers.length; i++) {
        if (done.has(i)) continue;
        done.add(i);
        const result = outcome(calls[i]!.value, i);
        if (result === 'ok') resolvers[i]!.resolve();
        else resolvers[i]!.reject(result);
      }
    },
  };
}

/** Let pending promise callbacks run. */
export async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
