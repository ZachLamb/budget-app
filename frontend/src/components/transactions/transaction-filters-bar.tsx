"use client";

import type { Account } from "@/lib/api/accounts";
import type { TransactionFilters } from "@/lib/api/transactions";
import type { FlatCategory } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { activeFilterChips, clearFiltersPatch } from "@/lib/transactions/active-filters";

export interface TransactionFiltersBarProps {
  filters: TransactionFilters;
  accounts: Account[];
  allCategories: FlatCategory[];
  onFiltersChange: (patch: Partial<TransactionFilters>) => void;
  /** Name of the payee behind `filters.payee_id`, when it is known. */
  payeeName?: string | null;
}

export function TransactionFiltersBar({
  filters,
  accounts,
  allCategories,
  onFiltersChange,
  payeeName,
}: TransactionFiltersBarProps) {
  const chips = activeFilterChips(filters, {
    payeeName,
    accountName: accounts.find((a) => a.id === filters.account_id)?.name,
    categoryName: allCategories.find((c) => c.id === filters.category_id)?.name,
  });

  return (
    <div className="sticky top-0 z-10 -mx-1 border-b bg-background/95 px-1 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <Card className="border-0 shadow-none">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search transactions..."
                aria-label="Search transactions"
                value={filters.search || ""}
                onChange={(e) => onFiltersChange({ search: e.target.value, page: 1 })}
              />
            </div>
            <Select
              value={filters.account_id || "all"}
              onValueChange={(v) =>
                onFiltersChange({ account_id: v === "all" ? undefined : v, page: 1 })
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.category_id || "all"}
              onValueChange={(v) =>
                onFiltersChange({
                  category_id: v === "all" ? undefined : v,
                  uncategorized: false,
                  page: 1,
                })
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {allCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.groupName} &gt; {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                type="date"
                className="w-36"
                value={filters.date_from || ""}
                onChange={(e) =>
                  onFiltersChange({ date_from: e.target.value || undefined, page: 1 })
                }
                placeholder="From"
                aria-label="From date"
              />
              <Input
                type="date"
                className="w-36"
                value={filters.date_to || ""}
                onChange={(e) =>
                  onFiltersChange({ date_to: e.target.value || undefined, page: 1 })
                }
                placeholder="To"
                aria-label="To date"
              />
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <span className="text-xs text-muted-foreground">Showing only:</span>
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() =>
                    onFiltersChange({
                      [chip.key]: chip.key === "uncategorized" ? false : undefined,
                      page: 1,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs hover:bg-muted"
                  aria-label={`Remove filter: ${chip.label}`}
                >
                  {chip.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onFiltersChange(clearFiltersPatch())}
              >
                Clear all
              </Button>
            </div>
          )}
        </CardHeader>
      </Card>
    </div>
  );
}
