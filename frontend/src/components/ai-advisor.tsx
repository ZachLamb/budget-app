"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { settingsApi } from "@/lib/api/settings";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot, Send, Loader2,
  ChevronDown, Trash2, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsClient } from "@/lib/hooks";
import Link from "next/link";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { useLlm } from "@/lib/llm/useLlm";
import { AiErrorWithSettings } from "@/components/llm/ai-error-with-settings";
import { userMessageFor } from "@/lib/llm/errors";
import type { QaActionResult } from "@/lib/llm/pipelines/qa";
import type { PipelineProgress } from "@/lib/llm/pipelines/types";
import api from "@/lib/api/client";
import { AiUnavailable } from "@/components/llm/ai-unavailable";
import { AiRunStatus } from "@/components/llm/ai-run-status";

const SUGGESTIONS = [
  "How can I pay off my debt faster?",
  "Where am I overspending this month?",
  "Help me create a savings plan",
  "What should I prioritize financially?",
];

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface PendingAction {
  preview: string;
  confirmationToken: string;
  actionType: string;
  data: Record<string, unknown>;
}

function AiAdvisorInner() {
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const isClient = useIsClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const closePanel = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => fabRef.current?.focus());
  }, []);

  const openAdvisor = useCallback(async () => {
    const prepared = await gate.prepareFeature("free_form_qa");
    if (!prepared.ok) {
      setUnavailable(true);
      setOpen(true);
      return;
    }
    setUnavailable(false);
    setOpen(true);
  }, [gate]);

  const toggleAdvisor = useCallback(async () => {
    if (open) {
      closePanel();
      return;
    }
    await openAdvisor();
  }, [open, openAdvisor, closePanel]);

  useEffect(() => {
    const shouldOpen = searchParams.get("ai_open") === "1";
    const prompt = searchParams.get("ai_prompt");
    if (!shouldOpen && !prompt) return;
    queueMicrotask(() => {
      if (shouldOpen) void openAdvisor();
      if (prompt) {
        try {
          setInput(decodeURIComponent(prompt));
        } catch {
          setInput(prompt);
        }
      }
      router.replace(pathname, { scroll: false });
    });
  }, [searchParams, pathname, router, openAdvisor]);

  const { data: aiSettings } = useQuery({
    queryKey: ["aiSettings"],
    queryFn: settingsApi.getAiSettings,
    enabled: isClient,
    staleTime: 60_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, progress]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const prepared = await gate.prepareFeature("free_form_qa");
    if (!prepared.ok) {
      setUnavailable(true);
      return;
    }

    setInput("");
    setError(null);
    setUnavailable(false);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    setStreaming(true);
    setProgress(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const result = await llm.runFeature(
        "free_form_qa",
        { question: text },
        {
          signal: ctrl.signal,
          onProgress: setProgress,
        },
      );

      if (
        result &&
        typeof result === "object" &&
        "kind" in result &&
        (result as { kind: string }).kind === "action"
      ) {
        const action = result as QaActionResult;
        setPendingAction({
          preview: action.preview,
          confirmationToken: action.confirmationToken,
          actionType: action.actionType,
          data: action.data,
        });
        return;
      }

      if (
        result &&
        typeof result === "object" &&
        "kind" in result &&
        (result as { kind: string }).kind === "answer"
      ) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: (result as unknown as { answer: string }).answer,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "I couldn't produce an answer." },
      ]);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(userMessageFor(e));
    } finally {
      setStreaming(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [gate, input, llm, streaming]);

  const confirmAction = useCallback(async () => {
    if (!pendingAction || actionPending) return;
    setActionPending(true);
    setError(null);
    try {
      const r = await api.post<{ success: boolean; message: string }>(
        "/ai/execute-action",
        {
          action_type: pendingAction.actionType,
          data: pendingAction.data,
          confirmation_token: pendingAction.confirmationToken,
        },
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: r.data.message },
      ]);
      setPendingAction(null);
    } catch (e) {
      setError(userMessageFor(e));
    } finally {
      setActionPending(false);
    }
  }, [actionPending, pendingAction]);

  const cancelAction = useCallback(() => {
    setPendingAction(null);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Cancelled — no changes were made." },
    ]);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setProgress(null);
    setPendingAction(null);
    setActionPending(false);
  };

  if (!isClient) return null;
  if (aiSettings && !aiSettings.ai_enabled) return null;

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        onClick={() => void toggleAdvisor()}
        className={cn(
          "fixed z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200",
          "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
          "right-6 bottom-[max(1.5rem,env(safe-area-inset-bottom))]",
          open && "scale-90 opacity-0 pointer-events-none",
        )}
        aria-label="Open AI advisor"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MessageSquare className="h-6 w-6" />
        {!open && streaming && (
          <span className="absolute top-1 right-1 h-3 w-3 rounded-full bg-green-400 animate-pulse" />
        )}
      </button>

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-advisor-title"
        className={cn(
          "fixed bottom-0 right-0 z-50 flex flex-col bg-background border-l border-t shadow-2xl transition-all duration-300 ease-in-out outline-none",
          "w-full sm:w-[440px] sm:rounded-tl-2xl",
          "pb-[env(safe-area-inset-bottom)]",
          open ? "h-[min(600px,calc(100dvh-env(safe-area-inset-bottom)))] translate-y-0 opacity-100" : "h-0 translate-y-4 opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 sm:rounded-tl-2xl">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p id="ai-advisor-title" className="text-sm font-semibold leading-none">AI Financial Advisor</p>
              <span className="text-xs text-muted-foreground">On-device · Private</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={clearChat}
                title="Clear chat"
                aria-label="Clear chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={closePanel}
              aria-label="Close AI advisor"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 px-4 py-3 overflow-y-auto">
          {unavailable && messages.length === 0 && (
            <AiUnavailable
              className="my-8"
              onStartSetup={() => void gate.ensureLocalSetup("free_form_qa")}
            />
          )}

          {messages.length === 0 && !unavailable && (
            <div className="flex flex-col items-center justify-center h-full min-h-[280px] gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-medium text-sm">Your personal finance advisor</p>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  Answers use your budget, balances, and goals — processed privately on your device.
                </p>
                <Link href="/settings" className="text-xs text-primary hover:underline">
                  What the AI uses (Settings)
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full max-w-[320px]">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); }}
                    className="text-left text-xs rounded-lg border px-3 py-2 text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn("mb-3 flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              {m.role === "assistant" && (
                <div className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2.5 text-sm max-w-[85%] min-w-0 whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm",
                )}
              >
                {m.content}
              </div>
            </div>
          ))}

          {pendingAction && (
            <div className="mb-3 rounded-xl border bg-muted/40 p-3 text-sm space-y-3">
              <p className="text-foreground">{pendingAction.preview}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void confirmAction()}
                  disabled={actionPending}
                >
                  {actionPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Applying…
                    </>
                  ) : (
                    "Confirm"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={cancelAction}
                  disabled={actionPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {streaming && (
            <div className="mb-3">
              <AiRunStatus
                progress={progress ?? { step: "start", label: "Starting…" }}
                onCancel={() => abortRef.current?.abort()}
              />
            </div>
          )}

          {error && (
            <div className="mb-2 px-4 text-center">
              <AiErrorWithSettings message={error} className="text-xs" />
            </div>
          )}

          <div ref={bottomRef} />
        </ScrollArea>

        <div className="p-3 border-t bg-muted/20">
          <div className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about your finances… (Enter to send)"
              rows={1}
              className="resize-none min-h-[40px] max-h-28 flex-1 bg-background text-sm rounded-xl border-muted-foreground/20"
              disabled={streaming || unavailable}
            />
            <Button
              size="icon"
              onClick={() => void send()}
              disabled={!input.trim() || streaming || unavailable}
              className="h-10 w-10 rounded-xl shrink-0"
            >
              {streaming
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function AiAdvisor() {
  return (
    <Suspense fallback={null}>
      <AiAdvisorInner />
    </Suspense>
  );
}
