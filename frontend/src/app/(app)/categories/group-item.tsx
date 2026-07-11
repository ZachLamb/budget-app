"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";
import { CategoryItem } from "./category-item";

export function GroupItem({
  group,
  expanded,
  onToggle,
  onRequestDelete,
  onRequestDeleteCategory,
}: {
  group: CategoryGroup;
  expanded: boolean;
  onToggle: () => void;
  onRequestDelete: () => void;
  onRequestDeleteCategory: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [newCat, setNewCat] = useState("");

  const createCatMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Category created");
      setNewCat("");
    },
    onError: (e) => toastApiError("Failed to create category", e),
  });

  const submitNewCat = () => {
    const name = newCat.trim();
    if (!name || createCatMutation.isPending) return;
    createCatMutation.mutate({ group_id: group.id, name });
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between p-3 hover:bg-accent/50">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium">{group.name}</span>
          {group.is_income && <Badge variant="outline" className="text-xs">Income</Badge>}
          <span className="text-xs text-muted-foreground">
            {group.categories.length} {group.categories.length === 1 ? "category" : "categories"}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          aria-label={`Delete group ${group.name}`}
          onClick={onRequestDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {expanded && (
        <div className="space-y-1 border-t px-3 pb-3 pt-2">
          {group.categories.length === 0 && (
            <p className="px-3 py-1.5 text-sm text-muted-foreground">No categories yet.</p>
          )}
          {group.categories.map((cat) => (
            <CategoryItem key={cat.id} category={cat} onRequestDelete={onRequestDeleteCategory} />
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Input
              className="h-8 text-sm"
              placeholder="Add category..."
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewCat();
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              aria-label={`Add category to ${group.name}`}
              disabled={!newCat.trim() || createCatMutation.isPending}
              onClick={submitNewCat}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
