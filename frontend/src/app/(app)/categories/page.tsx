"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { useIsClient } from "@/lib/hooks";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import { SkeletonTable } from "@/components/skeleton-table";
import { toastApiError } from "@/lib/toast-error";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GroupItem } from "./group-item";
import { useCollapsedGroups } from "./use-collapsed-groups";
import { describeCategoryDelete, describeGroupDelete } from "./delete-consequences";
import { moveGroup, moveCategory } from "./reorder";

function CategoriesContent() {
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const groupInputRef = useRef<HTMLInputElement>(null);
  const { isExpanded, toggle } = useCollapsedGroups();

  const { data: groups = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["categoryGroups"],
    queryFn: categoriesApi.listGroups,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const { data: usage } = useQuery({
    queryKey: ["categoryUsage"],
    queryFn: categoriesApi.usage,
    enabled: isClient,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
    queryClient.invalidateQueries({ queryKey: ["categoryUsage"] });
  };

  const createGroupMutation = useMutation({
    mutationFn: categoriesApi.createGroup,
    onSuccess: () => {
      invalidate();
      appToast.success("Group created");
      setNewGroup("");
    },
    onError: (e) => toastApiError("Failed to create group", e),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: categoriesApi.deleteGroup,
    onSuccess: () => {
      invalidate();
      appToast.success("Group deleted");
    },
    onError: (e) => toastApiError("Failed to delete group", e),
  });

  const deleteCatMutation = useMutation({
    mutationFn: categoriesApi.delete,
    onSuccess: () => {
      invalidate();
      appToast.success("Category deleted");
    },
    onError: (e) => toastApiError("Failed to delete category", e),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderGroupsMutation = useMutation({
    mutationFn: categoriesApi.reorderGroups,
    onError: (e) => toastApiError("Failed to reorder groups", e),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["categoryGroups"] }),
  });

  const reorderCatsMutation = useMutation({
    mutationFn: ({ group_id, ordered_ids }: { group_id: string; ordered_ids: string[] }) =>
      categoriesApi.reorderCategories(group_id, ordered_ids),
    onError: (e) => toastApiError("Failed to reorder categories", e),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["categoryGroups"] }),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const data = active.data.current as
      | { type: "group" }
      | { type: "category"; groupId: string }
      | undefined;
    if (!data) return;
    if (data.type === "group") {
      const next = moveGroup(groups, String(active.id), String(over.id));
      if (!next) return;
      queryClient.setQueryData(["categoryGroups"], next);
      reorderGroupsMutation.mutate(next.map((g) => g.id));
    } else {
      const next = moveCategory(groups, data.groupId, String(active.id), String(over.id));
      if (!next) return;
      queryClient.setQueryData(["categoryGroups"], next);
      const target = next.find((g) => g.id === data.groupId);
      if (target) {
        reorderCatsMutation.mutate({
          group_id: data.groupId,
          ordered_ids: target.categories.map((c) => c.id),
        });
      }
    }
  };

  const submitNewGroup = () => {
    const name = newGroup.trim();
    if (!name || createGroupMutation.isPending) return;
    createGroupMutation.mutate({ name });
  };

  const groupPendingDelete = groups.find((g) => g.id === deleteGroupId);
  const groupConsequence = describeGroupDelete(groupPendingDelete, usage);
  const catConsequence = describeCategoryDelete(deleteCatId ? usage?.[deleteCatId] : undefined);

  return (
    <div className="space-y-6">
      <PageHeader title="Categories" description="Organize income and spending with groups and categories." />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Input
              ref={groupInputRef}
              placeholder="New category group..."
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewGroup();
              }}
            />
            <Button
              size="sm"
              aria-label="Create group"
              disabled={!newGroup.trim() || createGroupMutation.isPending}
              onClick={submitNewGroup}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <QueryState
            isLoading={isLoading && !groups.length}
            isError={isError}
            error={error}
            onRetry={() => refetch()}
            isEmpty={!isLoading && groups.length === 0}
            emptyTitle="No category groups yet"
            emptyDescription="Create a group above to start organizing transactions."
            emptyAction={
              <Button type="button" variant="outline" size="sm" onClick={() => groupInputRef.current?.focus()}>
                Name your first group
              </Button>
            }
            loadingFallback={<SkeletonTable rows={4} columns={2} />}
          >
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                {groups.map((group: CategoryGroup) => (
                  <GroupItem
                    key={group.id}
                    group={group}
                    groups={groups}
                    usage={usage}
                    expanded={isExpanded(group.id)}
                    onToggle={() => toggle(group.id)}
                    onRequestDelete={() => setDeleteGroupId(group.id)}
                    onRequestDeleteCategory={setDeleteCatId}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </QueryState>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!deleteGroupId}
        onOpenChange={(open) => { if (!open) setDeleteGroupId(null); }}
        title="Delete Category Group"
        description={groupConsequence.message}
        confirmDisabled={groupConsequence.blocked}
        onConfirm={() => { if (deleteGroupId) deleteGroupMutation.mutate(deleteGroupId); }}
      />
      <ConfirmDialog
        open={!!deleteCatId}
        onOpenChange={(open) => { if (!open) setDeleteCatId(null); }}
        title="Delete Category"
        description={catConsequence.message}
        confirmDisabled={catConsequence.blocked}
        onConfirm={() => { if (deleteCatId) deleteCatMutation.mutate(deleteCatId); }}
      />
    </div>
  );
}

export default function CategoriesPage() {
  return <CategoriesContent />;
}
