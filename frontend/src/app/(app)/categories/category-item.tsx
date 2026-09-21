"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  categoriesApi,
  type Category,
  type CategoryGroup,
  type CategoryUsage,
  type DeductionKind,
} from "@/lib/api/categories";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "radix-ui";
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

// The tax engine values these two very differently, so the user has to say
// which one a deductible category is -- it cannot be inferred from the amount.
const KIND_BADGES: Record<DeductionKind, string> = {
  business_expense: "Business",
  personal_itemized: "Personal",
};

// A tax line names the form a deduction is filed on, and the two forms map
// straight onto the two kinds. Disagreement is almost always a mistake, and
// a silent one: it changes what the deduction is worth without changing
// anything visible.
const LINE_IMPLIES: { pattern: RegExp; kind: DeductionKind; form: string }[] = [
  { pattern: /schedule\s*e\b/i, kind: "business_expense", form: "Schedule E" },
  { pattern: /schedule\s*a\b/i, kind: "personal_itemized", form: "Schedule A" },
];

function mismatch(taxLine: string | null, kind: DeductionKind) {
  if (!taxLine) return null;
  const hit = LINE_IMPLIES.find((l) => l.pattern.test(taxLine));
  return hit && hit.kind !== kind ? hit : null;
}

const DEDUCTION_KINDS: { value: DeductionKind; label: string; help: string }[] = [
  {
    value: "business_expense",
    label: "Business expense",
    help: "Lowers your taxable income from the first dollar spent.",
  },
  {
    value: "personal_itemized",
    label: "Personal deduction",
    help: "Only counts once your itemized deductions beat the standard deduction.",
  },
];

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

  const [editing, setEditing] = useState(false);
  const [formState, setFormState] = useState({
    deductible: category.deductible,
    deduction_pct: category.deduction_pct,
    tax_line: category.tax_line,
    deduction_kind: category.deduction_kind,
  });

  useEffect(() => {
    if (!renaming) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [renaming]);

  const updateMutation = useMutation({
    mutationFn: (
      data: Partial<{
        name: string;
        group_id: string;
        deductible: boolean;
        deduction_pct: number;
        tax_line: string | null;
        deduction_kind: DeductionKind;
      }>,
    ) => categoriesApi.update(category.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Category updated");
      setRenaming(false);
      setEditing(false);
    },
    onError: (e) => toastApiError("Failed to update category", e),
  });

  const openEdit = () => {
    setFormState({
      deductible: category.deductible,
      deduction_pct: category.deduction_pct,
      tax_line: category.tax_line,
      deduction_kind: category.deduction_kind,
    });
    setEditing(true);
  };

  const submitEdit = () => {
    if (updateMutation.isPending) return;
    updateMutation.mutate({
      deductible: formState.deductible,
      deduction_pct: Math.min(100, Math.max(0, formState.deduction_pct)),
      tax_line: formState.tax_line,
      deduction_kind: formState.deduction_kind,
    });
  };

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
          {category.deductible && (
            <Badge
              variant="outline"
              className="text-[10px]"
              title={`Tax deductible — ${KIND_BADGES[category.deduction_kind].toLowerCase()}`}
            >
              {KIND_BADGES[category.deduction_kind]}
            </Badge>
          )}
          {usage && usage.transactions > 0 && (
            <span className="text-xs text-muted-foreground">
              {usage.transactions} txn{usage.transactions === 1 ? "" : "s"}
            </span>
          )}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs text-muted-foreground"
        aria-label={`Edit category ${category.name}`}
        onClick={openEdit}
      >
        Edit
      </Button>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {category.name}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Switch.Root
              id="deductible"
              aria-label="Tax deductible"
              checked={formState.deductible}
              onCheckedChange={(checked) => setFormState((s) => ({ ...s, deductible: checked }))}
              className="relative h-5 w-9 rounded-full bg-input data-[state=checked]:bg-primary"
            >
              <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-background transition-transform data-[state=checked]:translate-x-4" />
            </Switch.Root>
            <Label htmlFor="deductible">Tax deductible</Label>
          </div>
          {formState.deductible && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  How does this deduction work?
                </legend>
                {DEDUCTION_KINDS.map(({ value, label, help }) => {
                  const inputId = `deduction_kind-${value}-${category.id}`;
                  return (
                    <div key={value} className="flex items-start gap-2">
                      <input
                        type="radio"
                        id={inputId}
                        name={`deduction_kind-${category.id}`}
                        className="mt-1"
                        value={value}
                        checked={formState.deduction_kind === value}
                        aria-describedby={`${inputId}-help`}
                        onChange={() => setFormState((s) => ({ ...s, deduction_kind: value }))}
                      />
                      <div>
                        <Label htmlFor={inputId}>{label}</Label>
                        <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
                          {help}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {(() => {
                  const wrong = mismatch(formState.tax_line, formState.deduction_kind);
                  if (!wrong) return null;
                  return (
                    <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                      The tax line says {wrong.form}, and {wrong.form} is a{" "}
                      {wrong.kind === "business_expense"
                        ? "business expense"
                        : "personal deduction"}
                      , but this is marked as the other one. That changes what
                      it is worth — check which is right.
                    </p>
                  );
                })()}
              </fieldset>

              <div>
                <Label htmlFor="tax_line">Tax line</Label>
                <Input
                  id="tax_line"
                  value={formState.tax_line ?? ""}
                  onChange={(e) => setFormState((s) => ({ ...s, tax_line: e.target.value || null }))}
                  placeholder="e.g. Schedule E — Cleaning"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Where this lands on your return. Categories sharing a line
                  are totalled together on the Deductions page.
                </p>
              </div>

              <div>
                <Label htmlFor="deduction_pct">Deduction %</Label>
                <Input
                  id="deduction_pct"
                  type="number"
                  min={0}
                  max={100}
                  value={formState.deduction_pct}
                  onChange={(e) =>
                    setFormState((s) => ({
                      ...s,
                      deduction_pct: Math.min(100, Math.max(0, Number(e.target.value))),
                    }))
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave at 100 unless only part of this spending is
                  deductible — a phone line used half for the rental would be
                  50.
                </p>
              </div>
            </>
          )}

          <DialogFooter>
            <Button onClick={submitEdit} disabled={updateMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
