import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DepthDemo } from "./DepthDemo";

describe("DepthDemo", () => {
  it("renders three depth tabs in a tablist", () => {
    render(<DepthDemo />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Accessible" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("swaps the commentary when a different depth is selected", () => {
    render(<DepthDemo />);
    // Accessible copy is shown first.
    expect(screen.getByText(/spending a record \$52B next year/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Technical" }));
    // Technical copy replaces it; the panel is labelled by the active tab.
    expect(screen.getByText(/CoWoS-L \/ SoIC capacity/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Technical" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "depth-tab-technical",
    );
  });

  it("moves between depths with arrow keys", () => {
    render(<DepthDemo />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Briefed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
