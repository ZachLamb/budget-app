import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTransactionSelection } from "./use-transaction-selection";

const list = vi.fn();
vi.mock("@/lib/api/transactions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/transactions")>(
    "@/lib/api/transactions",
  );
  return {
    ...actual,
    BULK_MAX: 500,
    transactionsApi: { list: (...a: unknown[]) => list(...a) },
  };
});

const PAGE = ["a", "b", "c", "d", "e"];

beforeEach(() => list.mockReset());

describe("useTransactionSelection", () => {
  it("toggles one row on and off", () => {
    const { result } = renderHook(() => useTransactionSelection(PAGE));
    act(() => result.current.toggle("b", 1, false));
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle("b", 1, false));
    expect(result.current.count).toBe(0);
  });

  it("shift-click selects the run between the two clicks", () => {
    // The thing the feature exists for: a block of an import, not
    // forty individual ticks.
    const { result } = renderHook(() => useTransactionSelection(PAGE));
    act(() => result.current.toggle("b", 1, false));
    act(() => result.current.toggle("d", 3, true));
    expect([...result.current.selected].sort()).toEqual(["b", "c", "d"]);
  });

  it("shift-click extends backwards too", () => {
    const { result } = renderHook(() => useTransactionSelection(PAGE));
    act(() => result.current.toggle("d", 3, false));
    act(() => result.current.toggle("b", 1, true));
    expect([...result.current.selected].sort()).toEqual(["b", "c", "d"]);
  });

  it("shift-click from a deselected anchor clears the range", () => {
    const { result } = renderHook(() => useTransactionSelection(PAGE));
    act(() => result.current.setPage(PAGE, true));
    act(() => result.current.toggle("b", 1, false)); // now off
    act(() => result.current.toggle("d", 3, true));
    expect([...result.current.selected].sort()).toEqual(["a", "e"]);
  });

  it("shift-click with nothing clicked yet behaves as a plain click", () => {
    const { result } = renderHook(() => useTransactionSelection(PAGE));
    act(() => result.current.toggle("c", 2, true));
    expect([...result.current.selected]).toEqual(["c"]);
  });

  it("selects and deselects a whole page", () => {
    const { result } = renderHook(() => useTransactionSelection(PAGE));
    act(() => result.current.setPage(PAGE, true));
    expect(result.current.count).toBe(5);
    act(() => result.current.setPage(PAGE, false));
    expect(result.current.count).toBe(0);
  });

  it("keeps selections made on an earlier page", () => {
    // Paging is not a reason to lose what you ticked.
    const { result, rerender } = renderHook(
      ({ ids }) => useTransactionSelection(ids),
      { initialProps: { ids: PAGE } },
    );
    act(() => result.current.toggle("a", 0, false));
    rerender({ ids: ["x", "y"] });
    act(() => result.current.toggle("x", 0, false));
    expect([...result.current.selected].sort()).toEqual(["a", "x"]);
  });

  describe("select all matching", () => {
    it("pages the list endpoint rather than reimplementing the filters", async () => {
      list.mockResolvedValueOnce({
        transactions: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}` })),
      }).mockResolvedValueOnce({
        transactions: Array.from({ length: 50 }, (_, i) => ({ id: `u${i}` })),
      });

      const { result } = renderHook(() => useTransactionSelection(PAGE));
      let outcome: { selected: number; capped: boolean } | undefined;
      await act(async () => {
        outcome = await result.current.selectAllMatching(
          { uncategorized: true } as never,
          250,
        );
      });
      await waitFor(() => expect(result.current.count).toBe(250));
      expect(outcome).toEqual({ selected: 250, capped: false });
      // The filter went to the server; no clause was rebuilt here.
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ uncategorized: true, page: 1, page_size: 200 }),
      );
    });

    it("stops at the bulk cap and says so", async () => {
      // Distinct ids per page -- a single mockResolvedValue would hand
      // back the same array every time and the Set would dedupe it.
      let call = 0;
      list.mockImplementation(() => {
        call += 1;
        return Promise.resolve({
          transactions: Array.from({ length: 200 }, (_, i) => ({
            id: `p${call}-${i}`,
          })),
        });
      });
      const { result } = renderHook(() => useTransactionSelection(PAGE));
      let outcome: { selected: number; capped: boolean } | undefined;
      await act(async () => {
        outcome = await result.current.selectAllMatching({} as never, 5000);
      });
      expect(outcome).toEqual({ selected: 500, capped: true });
      expect(result.current.count).toBe(500);
    });

    it("stops when the server runs out of rows", async () => {
      // Guards the paging loop: a total that overstates what exists must
      // not spin forever.
      list.mockResolvedValueOnce({
        transactions: [{ id: "only" }],
      }).mockResolvedValue({ transactions: [] });
      const { result } = renderHook(() => useTransactionSelection(PAGE));
      await act(async () => {
        await result.current.selectAllMatching({} as never, 99);
      });
      expect(result.current.count).toBe(1);
    });

    it("replaces the selection rather than adding to it", async () => {
      list.mockResolvedValueOnce({ transactions: [{ id: "m1" }] })
        .mockResolvedValue({ transactions: [] });
      const { result } = renderHook(() => useTransactionSelection(PAGE));
      act(() => result.current.toggle("a", 0, false));
      await act(async () => {
        await result.current.selectAllMatching({} as never, 1);
      });
      expect([...result.current.selected]).toEqual(["m1"]);
    });
  });
});
