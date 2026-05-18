import { AuthGuard } from "@/components/auth-guard";
import { AiFeatureGateProvider } from "@/lib/llm/ai-feature-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AiFeatureGateProvider>{children}</AiFeatureGateProvider>
    </AuthGuard>
  );
}
