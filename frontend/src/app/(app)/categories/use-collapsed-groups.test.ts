import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCollapsedGroups } from "./use-collapsed-groups";

const KEY = "categories_collapsed_groups";

beforeEach(() => window.localStorage.clear());

describe("useCollapsedGroups", () => {
  it("expands unknown groups by default", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isExpanded("never-seen")).toBe(true);
  });

  it("toggle collapses, persists, and toggles back", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    act(() => result.current.toggle("g1"));
    expect(result.current.isExpanded("g1")).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toContain("g1");
    act(() => result.current.toggle("g1"));
    expect(result.current.isExpanded("g1")).toBe(true);
  });

  it("restores collapsed state from storage", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["g2"]));
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isExpanded("g2")).toBe(false);
    expect(result.current.isExpanded("g1")).toBe(true);
  });

  it("survives corrupted storage", () => {
    window.localStorage.setItem(KEY, "not-json{");
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isExpanded("g1")).toBe(true);
  });

  it("collapseAll and expandAll", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    act(() => result.current.collapseAll(["a", "b"]));
    expect(result.current.isExpanded("a")).toBe(false);
    expect(result.current.isExpanded("b")).toBe(false);
    act(() => result.current.expandAll());
    expect(result.current.isExpanded("a")).toBe(true);
  });
});
