import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Smartphone } from "lucide-react";

export const metadata = {
  title: "Privacy — Snack's Budget",
  description: "How Snack's Budget handles your financial data and AI features.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Privacy</h1>
        <p className="text-muted-foreground">
          Snack's Budget is a household budget app. Your data is yours. This page explains exactly how AI
          features handle your information on your device.
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
            For browsers without Gemini Nano (e.g., Safari, Firefox), Snack's Budget runs an open-source
            model in your browser using WebGPU. The model is downloaded once (700 MB or 1.8 GB) and
            cached on your device. After the one-time download, prompts and completions stay
            entirely on your device.
          </p>
          <p>
            We ask before downloading. If you decline, features that need a local model stay
            unavailable until you complete setup or use a Nano-capable browser.
          </p>
          <p className="text-muted-foreground">Data leaves device: <span className="font-medium text-foreground">No (after download).</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grounded facts from your household</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Heavy AI features fetch deterministic budget, goal, and context summaries from the
            Snack's Budget API before any model runs. Those endpoints return numbers and IDs only — never
            model output — and are scoped to your household with the same auth as the rest of the app.
          </p>
          <p className="text-muted-foreground">Model prompts or completions stored on our servers: <span className="font-medium text-foreground">No.</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is not used</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Snack's Budget never sends prompts to OpenAI, Anthropic, Google AI Studio, or any third-party model API.</p>
          <p>We do not log full request bodies of any AI call.</p>
          <p>Browser-side console logs do not include any AI content.</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Last updated: 2026-06-14.
      </p>
    </main>
  );
}
