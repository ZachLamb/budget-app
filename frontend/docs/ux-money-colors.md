# Money and chart colors (UX)

- **Charts**: Dashboard and other Recharts visuals should read series colors from theme tokens via `useChartColors()` in [`src/lib/hooks.ts`](../src/lib/hooks.ts) (`--chart-1` … `--chart-5` in [`src/app/globals.css`](../src/app/globals.css)).
- **Semantic green/red**: Reserve for **summary** metrics where sign matters at a glance (e.g. net worth, ready to assign overspent, debt totals, goal progress context)—not for every signed line item.
- **Routine flows**: Recent transactions and similar lists use **neutral** `text-foreground` so everyday debits do not read as “errors.”
