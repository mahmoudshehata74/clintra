import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

const UNSET = Symbol("unset");

/**
 * Subscribes to a Dexie live query so reads stay current after any write to
 * the tables the querier touches, without a manual refetch. deps works like
 * useEffect's dependency array: the subscription is re-created when any
 * dependency changes.
 */
export function useLiveQuery<T>(querier: () => Promise<T> | T, deps: readonly unknown[]): T | undefined {
  const [value, setValue] = useState<T | typeof UNSET>(UNSET);

  useEffect(() => {
    const subscription = liveQuery(querier).subscribe({
      next: (result) => setValue(result),
      error: (error: unknown) => {
        console.error(error);
      },
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller-supplied dependency array, mirroring useEffect's own contract.
  }, deps);

  return value === UNSET ? undefined : value;
}
