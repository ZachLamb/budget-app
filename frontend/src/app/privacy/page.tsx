import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Smartphone, Cloud, ShieldCheck, Lock, Database, Trash2 } from "lucide-react";

export const metadata = {
  title: "Privacy — Clarity",
  description: "How Clarity handles your financial data and AI features.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Privacy</h1>
        <p className="text-muted-foreground">
          Clarity is a household budget app. Your data is yours. This page explains exactly how AI
          features handle your information at each tier.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-5" /> Tier 1 — On-device (Gemini Nano)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Built into Chrome and Edge. Runs entirely on your device using your CPU/GPU. No prompts
            or completions cross the network during AI calls. The browser updates the model in the
            background through its own update channel — that is the only related network traffic
            and it is not tied to your data or your usage.
          </p>
          <p className="text-muted-foreground">Data leaves device: <span className="font-medium text-foreground">No.</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5" /> Tier 2 — On-device (WebGPU)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            For browsers without Gemini Nano (e.g., Safari, Firefox), Clarity runs an open-source
            model in your browser using WebGPU. The model is downloaded once (700 MB or 1.8 GB) and
            cached on your device. After the one-time download, prompts and completions stay
            entirely on your device.
          </p>
          <p>
            We ask before downloading. If you decline, the feature falls back to cloud (Tier 4) only
            when you have explicitly enabled cloud AI for that feature.
          </p>
          <p className="text-muted-foreground">Data leaves device: <span className="font-medium text-foreground">No (after download).</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="size-5" /> Tier 4 — Self-hosted cloud (opt-in only)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Some features (e.g., financial planning narratives) need a stronger model than what
            runs on a typical device. For those, Clarity offers a self-hosted cloud model. It is{" "}
            <span className="font-medium">off by default</span>. Each feature must be authorized
            individually.
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2"><ShieldCheck className="size-4 mt-0.5 shrink-0 text-green-600" /> Self-hosted on infrastructure we control. No third-party AI providers.</li>
            <li className="flex items-start gap-2"><Lock className="size-4 mt-0.5 shrink-0 text-green-600" /> Encrypted in transit (TLS). The model server is not publicly reachable.</li>
            <li className="flex items-start gap-2"><Database className="size-4 mt-0.5 shrink-0 text-green-600" /> We do not log request bodies. Audit logs record metadata only (user id, feature, tier, tokens, latency, status). No prompt or completion text is stored.</li>
            <li className="flex items-start gap-2"><ShieldCheck className="size-4 mt-0.5 shrink-0 text-green-600" /> We do not train on your data and we do not share it with anyone.</li>
            <li className="flex items-start gap-2"><Trash2 className="size-4 mt-0.5 shrink-0 text-green-600" /> Audit metadata is retained for 30 days. Cached completions are retained for 24 hours.</li>
          </ul>
          <p className="text-muted-foreground">Data leaves device: <span className="font-medium text-foreground">Yes, but only with explicit per-feature consent.</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revoking consent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Open <span className="font-medium">Settings → AI features</span> and either revoke a
            single feature or revoke all cloud consent at once. Revoking purges the per-user content
            cache for that user. Audit metadata older than 30 days is deleted automatically; you can
            request immediate deletion of metadata at any time.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is not used</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Clarity never sends prompts to OpenAI, Anthropic, Google AI Studio, or any third-party model API.</p>
          <p>We do not log full request bodies of any AI call. Server logs include status, latency, and token counts only.</p>
          <p>Browser-side console logs do not include any AI content.</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Last updated: 2026-04-26.
      </p>
    </main>
  );
}
