"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup, type CategoryUsageMap } from "@/lib/api/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, ChevronDown, ChevronRight } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";
import { CategoryItem } from "./category-item";

export function GroupItem({
  group,
  groups,
  usage,
  expanded,
  onToggle,
  onRequestDelete,
  onRequestDeleteCategory,
}: {
  group: CategoryGroup;
  groups: CategoryGroup[];
  usage?: CategoryUsageMap;
  expanded: boolean;
  onToggle: () => void;
  onRequestDelete: () => void;
  onRequestDeleteCategory: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [newCat, setNewCat] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [renaming]);

  const updateGroupMutation = useMutation({
    mutationFn: (data: Partial<{ name: string; is_income: boolean }>) =>
      categoriesApi.updateGroup(group.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Group updated");
      setRenaming(false);
    },
    onError: (e) => toastApiError("Failed to update group", e),
  });

  const commitRename = () => {
    const name = draft.trim();
    if (!name || name === group.name) {
      setRenaming(false);
      setDraft(group.name);
      return;
    }
    if (!updateGroupMutation.isPending) updateGroupMutation.mutate({ name });
  };

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
        {renaming ? (
          <Input
            ref={inputRef}
            className="h-7 flex-1 text-sm font-medium"
            value={draft}
            aria-label={`Rename group ${group.name}`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { commitRename(); }
              if (e.key === "Escape") {
                setRenaming(false);
                setDraft(group.name);
              }
            }}
          />
        ) : (
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
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              aria-label={`Group actions for ${group.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem
              onSelect={() => {
                setDraft(group.name);
                setRenaming(true);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => updateGroupMutation.mutate({ is_income: !group.is_income })}>
              {group.is_income ? "Mark as spending" : "Mark as income"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onRequestDelete}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded && (
        <div className="space-y-1 border-t px-3 pb-3 pt-2">
          {group.categories.length === 0 && (
            <p className="px-3 py-1.5 text-sm text-muted-foreground">No categories yet.</p>
          )}
          {group.categories.map((cat) => (
            <CategoryItem key={cat.id} category={cat} groups={groups} usage={usage?.[cat.id]} onRequestDelete={onRequestDeleteCategory} />
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
