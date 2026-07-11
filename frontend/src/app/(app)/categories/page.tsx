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
import { GroupItem } from "./group-item";
import { useCollapsedGroups } from "./use-collapsed-groups";

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

  const submitNewGroup = () => {
    const name = newGroup.trim();
    if (!name || createGroupMutation.isPending) return;
    createGroupMutation.mutate({ name });
  };

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
            {groups.map((group: CategoryGroup) => (
              <GroupItem
                key={group.id}
                group={group}
                expanded={isExpanded(group.id)}
                onToggle={() => toggle(group.id)}
                onRequestDelete={() => setDeleteGroupId(group.id)}
                onRequestDeleteCategory={setDeleteCatId}
              />
            ))}
          </QueryState>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!deleteGroupId}
        onOpenChange={(open) => { if (!open) setDeleteGroupId(null); }}
        title="Delete Category Group"
        description="This will permanently delete this group and all its categories."
        onConfirm={() => { if (deleteGroupId) deleteGroupMutation.mutate(deleteGroupId); }}
      />
      <ConfirmDialog
        open={!!deleteCatId}
        onOpenChange={(open) => { if (!open) setDeleteCatId(null); }}
        title="Delete Category"
        description="This will permanently delete this category."
        onConfirm={() => { if (deleteCatId) deleteCatMutation.mutate(deleteCatId); }}
      />
    </div>
  );
}

export default function CategoriesPage() {
  return <CategoriesContent />;
}
