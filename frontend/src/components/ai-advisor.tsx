"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { aiApi } from "@/lib/api/ai";
import type { ChatMessage } from "@/lib/api/ai";
import { settingsApi } from "@/lib/api/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot, X, Send, Loader2, Cpu, Sparkles, WifiOff,
  ChevronDown, Trash2, MessageSquare, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsClient, detailFromJsonBody, useDemoGuard } from "@/lib/hooks";
import Link from "next/link";
import { parseChatEvidence, type ChatEvidenceItem } from "@/lib/ai-evidence";
import { AI_COPY } from "@/lib/ai-copy";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { ChatEvidencePanel } from "@/components/chat-evidence-panel";

const SUGGESTIONS = [
  "How can I pay off my debt faster?",
  "Where am I overspending this month?",
  "Help me create a savings plan",
  "What should I prioritize financially?",
];

interface ParsedAction {
  action_type: string;
  data: Record<string, unknown>;
  confirmation_text: string;
  /** Single-use server-issued token; required by /execute-action. */
  confirmation_token: string;
}

function SourceBadge({ source }: { source: string }) {
  if (source === "ollama")
    return (
      <Badge variant="outline" className="text-xs gap-1 border-green-500 text-green-600 py-0">
        <Cpu className="h-2.5 w-2.5" /> Local AI
      </Badge>
    );
  if (source === "demo")
    return (
      <Badge variant="outline" className="text-xs gap-1 py-0">
        <Sparkles className="h-2.5 w-2.5" /> Demo
      </Badge>
    );
  return null;
}

interface Message extends ChatMessage {
  streaming?: boolean;
  pendingAction?: ParsedAction;
  actionStatus?: "pending" | "confirmed" | "cancelled";
  editData?: Record<string, string>;
  evidence?: ChatEvidenceItem[];
}

function AiAdvisorInner() {
  const { isDemo } = useDemoGuard();
  const gate = useAiFeatureGate();
  const isClient = useIsClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [modelSource, setModelSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [executingActionIdx, setExecutingActionIdx] = useState<number | null>(null);
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
    if (!prepared.ok) return;
    setOpen(true);
  }, [gate]);

  const toggleAdvisor = useCallback(async () => {
    if (open) {
      closePanel();
      return;
    }
    await openAdvisor();
  }, [open, openAdvisor, closePanel]);

  // Keep keyboard focus inside the panel while it is open.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );

    requestAnimationFrame(() => getFocusable()[0]?.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open]);

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

  const { data: status } = useQuery({
    queryKey: ["aiStatus"],
    queryFn: aiApi.status,
    enabled: isClient && (aiSettings?.ai_enabled ?? true),
    staleTime: 60_000,
  });

  const aiAvailable = status && status.active_backend !== "none";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

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

  const executeAction = useCallback(async (
    msgIdx: number,
    actionType: string,
    data: Record<string, unknown>,
    confirmationToken: string,
  ) => {
    // Auth via httpOnly session cookie — `credentials: "include"` ensures
    // the browser attaches it. Legacy fetch sites that read
    // localStorage("token") have been removed; the cookie is the source of truth.
    try {
      const resp = await fetch("/api/ai/execute-action", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action_type: actionType,
          data,
          confirmation_token: confirmationToken,
        }),
      });
      const raw = await resp.text();
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      const detail = obj ? detailFromJsonBody(obj) : null;
      const success = obj && typeof obj.success === "boolean" ? obj.success : false;
      const message =
        typeof obj?.message === "string" ? obj.message : null;

      const line =
        !resp.ok
          ? detail ?? message ?? `Request failed (${resp.status})`
          : success
            ? message ?? "Done."
            : message ?? detail ?? "Action could not be completed.";

      setMessages((prev) => {
        const copy = [...prev];
        copy[msgIdx] = {
          ...copy[msgIdx],
          actionStatus: resp.ok && success ? "confirmed" : "cancelled",
        };
        return [...copy, { role: "assistant", content: resp.ok && success ? line : `Error: ${line}` }];
      });
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        copy[msgIdx] = { ...copy[msgIdx], actionStatus: "cancelled" };
        return [...copy, { role: "assistant", content: "Sorry, I couldn't execute that action." }];
      });
    }
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const prepared = await gate.prepareFeature("free_form_qa");
    if (!prepared.ok) return;

    setInput("");
    setError(null);

    let snapshot: Message[] = [];
    setMessages((prev) => {
      snapshot = [...prev, { role: "user", content: text }];
      return snapshot;
    });

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch("/api/ai/advisor-turn", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: snapshot.map(({ role, content }) => ({ role, content })),
        }),
        signal: ctrl.signal,
      });

      const raw = await resp.text();
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

      if (!resp.ok) {
        const errLine = obj ? detailFromJsonBody(obj) : null;
        const line =
          errLine ??
          (raw && raw.length < 400 ? raw.slice(0, 400) : `Request failed (${resp.status})`);
        setMessages((prev) => [...prev, { role: "assistant", content: line }]);
        return;
      }

      if (!obj) {
        setMessages((prev) => [...prev, { role: "assistant", content: "Unexpected empty response." }]);
        return;
      }

      const branch = obj.branch;
      if (branch === "action" && typeof obj.action_type === "string" && obj.action_type) {
        const dataRaw = obj.data;
        const dataObj =
          dataRaw !== null && typeof dataRaw === "object" && !Array.isArray(dataRaw)
            ? (dataRaw as Record<string, unknown>)
            : {};
        const actionMsg: Message = {
          role: "assistant",
          content: String(obj.confirmation_text ?? ""),
          pendingAction: {
            action_type: obj.action_type,
            data: dataObj,
            confirmation_text: String(obj.confirmation_text ?? ""),
            confirmation_token: String(obj.confirmation_token ?? ""),
          },
          actionStatus: "pending",
          editData: Object.fromEntries(
            Object.entries(dataObj).map(([k, v]) => [k, String(v ?? "")]),
          ),
        };
        setMessages((prev) => [...prev, actionMsg]);
        if (typeof obj.model_source === "string") setModelSource(obj.model_source);
        return;
      }

      if (branch === "chat") {
        const reply = String(obj.reply ?? "");
        const evidence = parseChatEvidence(obj.evidence);
        if (typeof obj.model_source === "string") setModelSource(obj.model_source);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: reply,
            ...(evidence.length ? { evidence } : {}),
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Unexpected response from advisor. Please try again." },
      ]);
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        setMessages((prev) => prev.slice(0, snapshot.length));
      } else {
        setError((err as Error).message || "Failed to reach the AI advisor. Please try again.");
        setMessages((prev) => prev.slice(0, snapshot.length));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [gate, input, streaming]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setModelSource("");
  };

  if (!isClient) return null;
  if (aiSettings && !aiSettings.ai_enabled) return null;

  return (
    <>
      {/* Floating button */}
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

      {/* Panel */}
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
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 sm:rounded-tl-2xl">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p id="ai-advisor-title" className="text-sm font-semibold leading-none">AI Financial Advisor</p>
              <div className="flex items-center gap-1 mt-0.5">
                {modelSource ? (
                  <SourceBadge source={modelSource} />
                ) : status?.active_backend === "none" ? (
                  <Badge variant="destructive" className="text-xs gap-1 py-0">
                    <WifiOff className="h-2.5 w-2.5" /> Unavailable
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Local AI · Private</span>
                )}
              </div>
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

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-3 overflow-y-auto">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[280px] gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-medium text-sm">Your personal finance advisor</p>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  Answers use summaries we already store in the app (categories, balances, goals)—never your bank passwords.
                  With Ollama, the model runs on your machine; those summaries are only sent to your local server.
                </p>
                <Link href="/settings" className="text-xs text-primary hover:underline">
                  What the AI uses (Settings)
                </Link>
              </div>
              {aiAvailable ? (
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
              ) : (
                <p className="text-xs text-destructive text-center">
                  {AI_COPY.noBackendShort}
                </p>
              )}
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
                {m.streaming && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-current opacity-70 animate-pulse align-middle rounded-sm" />
                )}
                {m.role === "assistant" && !m.streaming && (m.evidence?.length ?? 0) > 0 && (
                  <ChatEvidencePanel items={m.evidence ?? []} />
                )}
                {m.pendingAction && m.actionStatus === "pending" && (
                  <div className="mt-3 space-y-2 border-t border-border/50 pt-2">
                    {m.pendingAction && (
                      <div className="rounded-md bg-background/80 border px-2 py-2 space-y-1 text-sm">
                        <p className="text-xs font-medium text-muted-foreground">You&apos;re about to apply:</p>
                        <ul className="font-medium text-foreground space-y-0.5">
                          {Object.entries({
                            ...Object.fromEntries(
                              Object.entries(m.pendingAction.data as Record<string, unknown>).map(([k, v]) => [
                                k,
                                String(v ?? ""),
                              ]),
                            ),
                            ...(m.editData ?? {}),
                          }).map(([key, val]) => (
                            <li key={key}>
                              <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}: </span>
                              {val || "—"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Review details</p>
                    {m.editData && Object.entries(m.editData).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground capitalize w-24 shrink-0">
                          {key.replace(/_/g, " ")}
                        </span>
                        {key === "date" || key === "due_date" ? (
                          <input
                            type="date"
                            className="rounded border bg-background px-2 py-0.5 text-xs flex-1"
                            value={val}
                            onChange={(e) => {
                              setMessages((prev) => {
                                const copy = [...prev];
                                copy[i] = {
                                  ...copy[i],
                                  editData: { ...copy[i].editData, [key]: e.target.value },
                                };
                                return copy;
                              });
                            }}
                          />
                        ) : (
                          <input
                            type="text"
                            className="rounded border bg-background px-2 py-0.5 text-xs flex-1"
                            value={val}
                            onChange={(e) => {
                              setMessages((prev) => {
                                const copy = [...prev];
                                copy[i] = {
                                  ...copy[i],
                                  editData: { ...copy[i].editData, [key]: e.target.value },
                                };
                                return copy;
                              });
                            }}
                          />
                        )}
                      </div>
                    ))}
                    {isDemo ? (
                      <p className="text-xs text-muted-foreground pt-1">
                        Demo is read-only — you can&apos;t apply actions here. Sign up for your own household to confirm changes.
                      </p>
                    ) : null}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isDemo || executingActionIdx !== null}
                        onClick={() => {
                          if (!m.pendingAction || executingActionIdx !== null) return;
                          const mergedData = { ...m.pendingAction.data, ...m.editData };
                          setExecutingActionIdx(i);
                          void executeAction(
                            i,
                            m.pendingAction.action_type,
                            mergedData as Record<string, unknown>,
                            m.pendingAction.confirmation_token,
                          ).finally(() => setExecutingActionIdx(null));
                        }}
                      >
                        <Check className="mr-1 h-3 w-3" /> Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setMessages((prev) => {
                            const copy = [...prev];
                            copy[i] = { ...copy[i], actionStatus: "cancelled" };
                            return copy;
                          });
                        }}
                      >
                        <X className="mr-1 h-3 w-3" /> Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {m.actionStatus === "confirmed" && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-green-600">
                    <Check className="h-3 w-3" /> Done
                  </div>
                )}
                {m.actionStatus === "cancelled" && (
                  <div className="mt-1 text-xs text-muted-foreground">Cancelled — feel free to rephrase.</div>
                )}
              </div>
            </div>
          ))}

          {error && (
            <p className="text-xs text-destructive text-center mb-2 px-4">{error}</p>
          )}

          <div ref={bottomRef} />
        </ScrollArea>

        {/* Input */}
        <div className="p-3 border-t bg-muted/20">
          <div className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={aiAvailable ? "Ask about your finances… (Enter to send)" : "AI unavailable"}
              rows={1}
              className="resize-none min-h-[40px] max-h-28 flex-1 bg-background text-sm rounded-xl border-muted-foreground/20"
              disabled={!aiAvailable || streaming}
            />
            <Button
              size="icon"
              onClick={send}
              disabled={!input.trim() || !aiAvailable || streaming}
              className="h-10 w-10 rounded-xl shrink-0"
            >
              {streaming
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {status?.active_backend === "ollama" && (
            <p className="text-center text-[10px] text-muted-foreground mt-1.5">
              Running locally via Ollama — your data stays on your machine
            </p>
          )}
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
