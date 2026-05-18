import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground text-sm max-w-sm">
        That route doesn&apos;t exist in your budget app.
      </p>
      <Button asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
