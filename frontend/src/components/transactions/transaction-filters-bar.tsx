"use client";

import type { Account } from "@/lib/api/accounts";
import type { TransactionFilters } from "@/lib/api/transactions";
import type { FlatCategory } from "@/lib/hooks";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

export interface TransactionFiltersBarProps {
  filters: TransactionFilters;
  accounts: Account[];
  allCategories: FlatCategory[];
  onFiltersChange: (patch: Partial<TransactionFilters>) => void;
}

export function TransactionFiltersBar({
  filters,
  accounts,
  allCategories,
  onFiltersChange,
}: TransactionFiltersBarProps) {
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
              />
              <Input
                type="date"
                className="w-36"
                value={filters.date_to || ""}
                onChange={(e) =>
                  onFiltersChange({ date_to: e.target.value || undefined, page: 1 })
                }
                placeholder="To"
              />
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
