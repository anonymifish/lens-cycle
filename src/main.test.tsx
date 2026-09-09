// @vitest-environment jsdom
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ render: vi.fn(), createRoot: vi.fn() }));

vi.mock("react-dom/client", () => ({
  createRoot: mocks.createRoot
}));
vi.mock("./app/App", () => ({ App: () => <div>application</div> }));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  mocks.render.mockReset();
  mocks.createRoot.mockReset();
  mocks.createRoot.mockReturnValue({ render: mocks.render });
});

it("mounts the application into the root element", async () => {
  await import("./main");
  expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
  const node = mocks.render.mock.calls[0]![0] as ReactNode;
  expect(node).toBeTruthy();
});
