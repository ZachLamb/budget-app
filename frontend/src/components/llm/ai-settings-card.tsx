"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Cpu, Smartphone, Trash2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { llmApi } from "@/lib/api/llm";
import { listFeatures } from "@/lib/llm/features";
import { getCapability } from "@/lib/llm/capability";
import { getLocalConsent, setDownloadModel, setUseLiteModel, clearLocalConsent } from "@/lib/llm/consent";
import type { CapabilitySnapshot } from "@/lib/llm/types";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

export function AiSettingsCard() {
  const qc = useQueryClient();
  const [cap, setCap] = useState<CapabilitySnapshot | null>(null);
  const [downloadModelChoice, setDownloadModelChoice] = useState<"granted" | "denied" | "unset">("unset");
  const [useLite, setUseLite] = useState(false);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      const local = getLocalConsent();
      setDownloadModelChoice(local.downloadModel ?? "unset");
      setUseLite(Boolean(local.useLiteModel));
    });
    getCapability().then((c) => {
      if (mounted) setCap(c);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const grants = useQuery({
    queryKey: ["llmCloudConsent"],
    queryFn: () => llmApi.listCloudConsent(),
  });

  const revokeOne = useMutation({
    mutationFn: (feature: string) => llmApi.revokeCloudConsent(feature),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llmCloudConsent"] });
      appToast.success("Cloud consent revoked");
    },
    onError: (e) => toastApiError("Failed to revoke consent", e),
  });

  const revokeAll = useMutation({
    mutationFn: () => llmApi.revokeAllCloudConsent(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llmCloudConsent"] });
      appToast.success("All cloud consent revoked");
    },
    onError: (e) => toastApiError("Failed to revoke consent", e),
  });

  const activeGrants = (grants.data ?? []).filter((g) => !g.revokedAt);
  const cloudPossibleFeatures = listFeatures().filter((f) => f.cloudPossible);

  const tierStatus = (
    <div className="grid gap-3 sm:grid-cols-3">
      <TierStatus
        icon={<Cpu className="size-4" />}
        title="On-device (Nano)"
        subtitle="Chrome / Edge built-in"
        ok={cap?.nano.available ?? false}
        statusText={
          cap?.nano.status === "available"
            ? "Ready"
            : cap?.nano.status === "downloadable"
            ? "Available — first use will download"
            : cap?.nano.status === "downloading"
            ? "Downloading"
            : cap?.nano.status === "unavailable"
            ? "Hardware not supported"
            : "Not in this browser"
        }
      />
      <TierStatus
        icon={<Smartphone className="size-4" />}
        title="On-device (WebGPU)"
        subtitle={cap?.webgpu.modelSize === "1b" ? "Lite model (~700 MB)" : "Standard model (~1.8 GB)"}
        ok={cap?.webgpu.available ?? false}
        statusText={
          !cap?.webgpu.available
            ? "WebGPU not available"
            : downloadModelChoice === "granted"
            ? "Downloaded"
            : "Not downloaded yet"
        }
      />
      <TierStatus
        icon={<Cloud className="size-4" />}
        title="Cloud AI (opt-in)"
        subtitle="Self-hosted, never trained"
        ok={activeGrants.length > 0}
        statusText={
          activeGrants.length === 0
            ? "Off — no features authorized"
            : `${activeGrants.length} feature${activeGrants.length === 1 ? "" : "s"} authorized`
        }
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI features</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {tierStatus}

        <Separator />

        <section className="space-y-3">
          <header>
            <h3 className="text-sm font-medium">On-device model storage</h3>
            <p className="text-sm text-muted-foreground">
              Models are downloaded once and run entirely in your browser.
            </p>
          </header>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={downloadModelChoice === "granted" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setDownloadModel("granted");
                setDownloadModelChoice("granted");
              }}
              disabled={cap?.webgpu.available !== true}
            >
              Allow download
            </Button>
            <Button
              variant={downloadModelChoice === "denied" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setDownloadModel("denied");
                setDownloadModelChoice("denied");
              }}
            >
              Don&apos;t download
            </Button>
            <Button
              variant={useLite ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const next = !useLite;
                setUseLiteModel(next);
                setUseLite(next);
              }}
              disabled={cap?.webgpu.available !== true}
            >
              {useLite ? "Using Lite (700 MB)" : "Use Lite (700 MB)"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearLocalConsent();
                setDownloadModelChoice("unset");
                setUseLite(false);
              }}
            >
              Reset choices
            </Button>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium">Cloud AI consent</h3>
              <p className="text-sm text-muted-foreground">
                Off by default. Required for advanced features that the small on-device model can&apos;t handle reliably.
                Hosted on our private servers — never logged, never used for training.{" "}
                <Link href="/privacy" className="underline inline-flex items-center gap-1">
                  Privacy details <ExternalLink className="size-3" />
                </Link>
              </p>
            </div>
            {activeGrants.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revokeAll.mutate()}
                disabled={revokeAll.isPending}
              >
                <Trash2 className="size-4" /> Revoke all
              </Button>
            )}
          </header>

          {cloudPossibleFeatures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No features use cloud AI.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {cloudPossibleFeatures.map((f) => {
                const isGranted = activeGrants.some((g) => g.feature === f.id);
                return (
                  <li key={f.id} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{f.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.minimumTier === 4 ? "Cloud-only" : "Defaults to on-device"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isGranted ? (
                        <>
                          <Badge variant="secondary">Authorized</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revokeOne.mutate(f.id)}
                            disabled={revokeOne.isPending}
                          >
                            Revoke
                          </Button>
                        </>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Not authorized</Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function TierStatus({
  icon,
  title,
  subtitle,
  ok,
  statusText,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  ok: boolean;
  statusText: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span
          className={`inline-block size-2 rounded-full ${ok ? "bg-green-500" : "bg-muted-foreground/40"}`}
        />
        <span>{statusText}</span>
      </div>
    </div>
  );
}
