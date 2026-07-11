"use client";

import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Category } from "@/lib/api/categories";

export function CategoryItem({
  category,
  onRequestDelete,
}: {
  category: Category;
  onRequestDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded px-3 py-1.5 hover:bg-muted">
      <span className="text-sm">{category.name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        aria-label={`Delete category ${category.name}`}
        onClick={() => onRequestDelete(category.id)}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
