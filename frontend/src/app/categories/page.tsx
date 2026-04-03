"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { appToast } from "@/lib/app-toast";
import { useIsClient } from "@/lib/hooks";
import { ConfirmDialog } from "@/components/confirm-dialog";

function CategoriesContent() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [newCats, setNewCats] = useState<Record<string, string>>({});

  const queryClient = useQueryClient();
  const isClient = useIsClient();
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["categoryGroups"],
    queryFn: categoriesApi.listGroups,
    enabled: isClient,
  });

  const createGroupMutation = useMutation({
    mutationFn: categoriesApi.createGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Group created");
      setNewGroup("");
    },
  });

  const createCatMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Category created");
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: categoriesApi.deleteGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Group deleted");
    },
  });

  const deleteCatMutation = useMutation({
    mutationFn: categoriesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categoryGroups"] });
      appToast.success("Category deleted");
    },
  });

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Categories</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Input
              placeholder="New category group..."
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newGroup.trim()) {
                  createGroupMutation.mutate({ name: newGroup.trim() });
                }
              }}
            />
            <Button
              size="sm"
              disabled={!newGroup.trim()}
              onClick={() => createGroupMutation.mutate({ name: newGroup.trim() })}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : (
            groups.map((group: CategoryGroup) => (
              <div key={group.id} className="rounded-lg border">
                <div
                  className="flex cursor-pointer items-center justify-between p-3 hover:bg-accent"
                  onClick={() => toggleExpand(group.id)}
                >
                  <div className="flex items-center gap-2">
                    {expanded.has(group.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-medium">{group.name}</span>
                    {group.is_income && <Badge variant="outline" className="text-xs">Income</Badge>}
                    <span className="text-xs text-muted-foreground">{group.categories.length} categories</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setDeleteGroupId(group.id); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {expanded.has(group.id) && (
                  <div className="border-t px-3 pb-3 pt-2 space-y-1">
                    {group.categories.map((cat) => (
                      <div key={cat.id} className="flex items-center justify-between rounded px-3 py-1.5 hover:bg-muted">
                        <span className="text-sm">{cat.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteCatId(cat.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <Input
                        className="h-8 text-sm"
                        placeholder="Add category..."
                        value={newCats[group.id] || ""}
                        onChange={(e) => setNewCats({ ...newCats, [group.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newCats[group.id]?.trim()) {
                            createCatMutation.mutate({ group_id: group.id, name: newCats[group.id].trim() });
                            setNewCats({ ...newCats, [group.id]: "" });
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!newCats[group.id]?.trim()}
                        onClick={() => {
                          createCatMutation.mutate({ group_id: group.id, name: newCats[group.id].trim() });
                          setNewCats({ ...newCats, [group.id]: "" });
                        }}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
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
  return <AuthGuard><CategoriesContent /></AuthGuard>;
}
