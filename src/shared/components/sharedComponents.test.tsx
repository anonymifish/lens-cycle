// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import { LocalDateInput } from "./LocalDateInput";

afterEach(cleanup);

describe("shared components", () => {
  it("renders compact empty-state guidance and runs both actions", () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    render(<EmptyState
      compact description="先准备资料" eyebrow="空状态" icon="inventory"
      primaryAction={{ label: "开始", onClick: primary }}
      secondaryAction={{ label: "稍后", onClick: secondary }}
      steps={["建立产品", "完成入库"]} title="暂无库存"
    />);
    expect(screen.getByText("建立产品")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(primary).toHaveBeenCalledOnce();
    expect(secondary).toHaveBeenCalledOnce();
  });

  it("renders an empty state without optional guidance or actions", () => {
    const { container } = render(<EmptyState
      description="没有结果" eyebrow="搜索" icon="search" title="未找到"
    />);
    expect(container.querySelector("ol")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("validates typed dates and forwards change, blur, and click events", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const onClick = vi.fn();
    render(<LocalDateInput
      defaultValue="2026-09-06" max="2026-12-31" min="2026-01-01"
      name="date" onBlur={onBlur} onChange={onChange} onClick={onClick}
    />);
    const text = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(text, { target: { value: "2027-01-01" } });
    expect(text.validationMessage).not.toBe("");
    fireEvent.blur(text);
    fireEvent.click(text);
    expect(onChange).toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
  });

  it("supports controlled, disabled, read-only, native picker, and picker fallback paths", () => {
    const { rerender, container } = render(<LocalDateInput value="2026-09-06" />);
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement & { showPicker?: () => void };
    expect(getComputedStyle(picker).pointerEvents).toBe("none");
    picker.showPicker = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "打开日期选择器" }));
    expect(picker.showPicker).toHaveBeenCalledOnce();

    picker.showPicker = () => { throw new Error("unsupported"); };
    const focus = vi.spyOn(picker, "focus");
    fireEvent.click(screen.getByRole("textbox"));
    expect(focus).toHaveBeenCalled();

    rerender(<LocalDateInput disabled value="2026-09-06" />);
    fireEvent.click(screen.getByRole("button", { name: "打开日期选择器" }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("2026-09-06");

    rerender(<LocalDateInput readOnly value="2026-09-06" />);
    expect(screen.queryByRole("button", { name: "打开日期选择器" })).toBeNull();
  });
});
