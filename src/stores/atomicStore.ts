import { create as createZustand, type StateCreator } from "zustand";

type Notifications = Map<object, () => void>;
let pending: Notifications | undefined;

/** Synchronous view publication only; this is not a persistence transaction.
 * Callers must restore candidate state before leaving a discarded scope.
 */
export function batchStoreNotifications<T>(operation: () => T, publish = true): T {
  const parent = pending;
  const notifications: Notifications = new Map();
  pending = notifications;
  let result: T;
  try {
    result = operation();
  } finally {
    pending = parent;
  }
  if (publish) {
    for (const [key, notify] of notifications) {
      if (parent) {
        if (!parent.has(key)) parent.set(key, notify);
      } else {
        notify();
      }
    }
  }
  return result;
}

/** Zustand stores whose subscribers observe only completed multi-store views. */
export function create<T>() {
  return (initializer: StateCreator<T>) => createZustand<T>()((set, get, api) => {
    const subscribe = api.subscribe;
    api.subscribe = (listener) => {
      const key = {};
      let active = true;
      const unsubscribe = subscribe((state, previous) => {
        if (!pending) {
          listener(state, previous);
        } else if (!pending.has(key)) {
          pending.set(key, () => {
            if (active && !Object.is(get(), previous)) listener(get(), previous);
          });
        }
      });
      return () => { active = false; unsubscribe(); };
    };
    return initializer(set, get, api);
  });
}
