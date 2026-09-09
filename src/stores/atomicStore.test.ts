import { describe, expect, it, vi } from "vitest";
import { batchStoreNotifications, create } from "./atomicStore";

function store() {
  return create<{ value: number; increment: () => void }>()(set => ({
    value: 0, increment: () => set(state => ({ value: state.value + 1 }))
  }));
}

describe("atomic domain store notifications", () => {
  it("preserves normal subscriptions, action setters and unsubscribe", () => {
    const state = store();
    const listener = vi.fn();
    const stop = state.subscribe(listener);
    state.getState().increment();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].value).toBe(1);
    expect(listener.mock.calls[0]![1].value).toBe(0);
    stop();
    state.setState({ value: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes once and every subscriber sees the complete cross-store result", () => {
    const first = store();
    const second = store();
    const values: number[][] = [];
    first.subscribe((next, previous) => values.push([next.value, previous.value, second.getState().value]));
    const listener = vi.fn();
    second.subscribe(listener);
    const result = batchStoreNotifications(() => {
      first.getState().increment();
      batchStoreNotifications(() => {
        first.getState().increment();
        second.getState().increment();
      });
      expect(values).toEqual([]);
      return 42;
    });
    expect(result).toBe(42);
    expect(values).toEqual([[2, 0, 1]]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("discards restored candidates and allows subsequent normal notifications", () => {
    const state = store();
    const listener = vi.fn();
    state.subscribe(listener);
    const original = state.getState();
    batchStoreNotifications(() => {
      state.getState().increment();
      state.setState(original, true);
    }, false);
    expect(listener).not.toHaveBeenCalled();
    state.getState().increment();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("restores notification scope after a throwing operation", () => {
    const state = store();
    const listener = vi.fn();
    state.subscribe(listener);
    expect(() => batchStoreNotifications(() => { throw new Error("failed"); })).toThrow("failed");
    state.getState().increment();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify subscriptions removed during a batch or unchanged references", () => {
    const state = store();
    const listener = vi.fn();
    const stop = state.subscribe(listener);
    batchStoreNotifications(() => { state.getState().increment(); stop(); });
    expect(listener).not.toHaveBeenCalled();
    state.subscribe(listener);
    const original = state.getState();
    batchStoreNotifications(() => {
      state.getState().increment();
      state.setState(original, true);
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
