import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The toggle fires an analytics event; stub it so the test asserts
// behavior without a transport.
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("adds the .dark class and persists when toggled on from light", () => {
    render(<ThemeToggle />);
    // Starts light → shows the Moon (go-dark) affordance.
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("removes the .dark class and persists when toggled back to light", () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("exposes an accessible label that reflects the next action", () => {
    render(<ThemeToggle />);
    // Light on mount → the control offers switching to dark.
    expect(
      screen.getByRole("button", { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
  });
});
