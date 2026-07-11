"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type Category, type CategoryGroup } from "@/lib/api/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";

export function CategoryItem({
  category,
  groups,
  onRequestDelete,
}: {
  category: Category;
  groups: CategoryGroup[];
  onRequestDelete: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const skipNextBlurRef = useRef(false);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<{ name: string; group_id: string }>) =>
      categoriesApi.update(category.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Category updated");
      setRenaming(false);
    },
    onError: (e) => toastApiError("Failed to update category", e),
  });

  const commitRename = () => {
    if (skipNextBlurRef.current) {
      skipNextBlurRef.current = false;
      return;
    }
    const name = draft.trim();
    if (!name || name === category.name) {
      setRenaming(false);
      setDraft(category.name);
      return;
    }
    if (!updateMutation.isPending) updateMutation.mutate({ name });
  };

  const otherGroups = groups.filter((g) => g.id !== category.group_id);

  return (
    <div className="flex items-center justify-between gap-2 rounded px-3 py-1.5 hover:bg-muted">
      {renaming ? (
        <Input
          autoFocus
          className="h-7 text-sm"
          value={draft}
          aria-label={`Rename category ${category.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => { skipNextBlurRef.current = true; }}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") { skipNextBlurRef.current = false; commitRename(); }
            if (e.key === "Escape") {
              setRenaming(false);
              setDraft(category.name);
            }
          }}
        />
      ) : (
        <span className="text-sm">{category.name}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            aria-label={`Category actions for ${category.name}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(category.name);
              setRenaming(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          {otherGroups.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {otherGroups.map((g) => (
                    <DropdownMenuItem key={g.id} onSelect={() => updateMutation.mutate({ group_id: g.id })}>
                      {g.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onRequestDelete(category.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
