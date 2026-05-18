import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title?: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn(className)}>
      <CardContent className="py-12 text-center space-y-3">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className="text-muted-foreground text-sm">{description}</div>
        {action ? <div className="pt-1">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
