"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type Category, type CategoryGroup, type CategoryUsage } from "@/lib/api/categories";
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
import { MoreHorizontal, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";

export function CategoryItem({
  category,
  groups,
  usage,
  onRequestDelete,
}: {
  category: Category;
  groups: CategoryGroup[];
  usage?: CategoryUsage;
  onRequestDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    data: { type: "category", groupId: category.group_id },
  });

  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [renaming]);

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
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center justify-between gap-2 rounded px-3 py-1.5 hover:bg-muted", isDragging && "opacity-70")}
    >
      <button
        type="button"
        className="cursor-grab touch-none p-0.5 text-muted-foreground"
        aria-label={`Reorder category ${category.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {renaming ? (
        <Input
          ref={inputRef}
          className="h-7 text-sm"
          value={draft}
          aria-label={`Rename category ${category.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commitRename(); }
            if (e.key === "Escape") {
              setRenaming(false);
              setDraft(category.name);
            }
          }}
        />
      ) : (
        <span className="flex items-baseline gap-2 text-sm">
          {category.name}
          {usage && usage.transactions > 0 && (
            <span className="text-xs text-muted-foreground">
              {usage.transactions} txn{usage.transactions === 1 ? "" : "s"}
            </span>
          )}
        </span>
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
        <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
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
