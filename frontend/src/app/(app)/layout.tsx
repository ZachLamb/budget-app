import { AuthGuard } from "@/components/auth-guard";
import { CycleVisitTracker } from "@/components/cycle-visit-tracker";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <CycleVisitTracker />
      {children}
    </AuthGuard>
  );
}
