"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { aiApi } from "@/lib/api/ai";
import type { ChatMessage } from "@/lib/api/ai";
import { settingsApi } from "@/lib/api/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot, X, Send, Loader2, Cpu, Cloud, WifiOff,
  ChevronDown, Trash2, MessageSquare, Check, Edit2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsClient } from "@/lib/hooks";

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
}

function SourceBadge({ source }: { source: string }) {
  if (source === "ollama")
    return (
      <Badge variant="outline" className="text-xs gap-1 border-green-500 text-green-600 py-0">
        <Cpu className="h-2.5 w-2.5" /> Local AI
      </Badge>
    );
  if (source === "claude")
    return (
      <Badge variant="outline" className="text-xs gap-1 py-0">
        <Cloud className="h-2.5 w-2.5" /> Claude
      </Badge>
    );
  return null;
}

interface Message extends ChatMessage {
  streaming?: boolean;
  pendingAction?: ParsedAction;
  actionStatus?: "pending" | "confirmed" | "cancelled";
  editData?: Record<string, string>;
}

export function AiAdvisor() {
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [modelSource, setModelSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const executeAction = useCallback(async (msgIdx: number, actionType: string, data: Record<string, unknown>) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    try {
      const resp = await fetch("/api/ai/execute-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action_type: actionType, data }),
      });
      const result = await resp.json();
      setMessages((prev) => {
        const copy = [...prev];
        copy[msgIdx] = { ...copy[msgIdx], actionStatus: "confirmed" };
        return [
          ...copy,
          { role: "assistant", content: result.success ? result.message : `Error: ${result.message}` },
        ];
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
    setInput("");
    setError(null);

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);

    // First, check for action intents
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    try {
      const parseResp = await fetch("/api/ai/parse-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text }),
      });
      if (parseResp.ok) {
        const parsed = await parseResp.json();
        if (parsed.action_type) {
          const actionMsg: Message = {
            role: "assistant",
            content: parsed.confirmation_text,
            pendingAction: parsed as ParsedAction,
            actionStatus: "pending",
            editData: Object.fromEntries(
              Object.entries(parsed.data as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
            ),
          };
          setMessages((prev) => [...prev, actionMsg]);
          setStreaming(false);
          return;
        }
      } else {
        let errMsg = `Request failed (${parseResp.status})`;
        try {
          const text = await parseResp.text();
          try {
            const errBody = JSON.parse(text);
            if (errBody?.detail && typeof errBody.detail === "string") errMsg = errBody.detail;
          } catch {
            if (text) errMsg = text.slice(0, 200);
          }
        } catch {
          /* ignore */
        }
        setMessages((prev) => [...prev, { role: "assistant", content: errMsg }]);
        setStreaming(false);
        return;
      }
    } catch {
      // If parse fails (e.g. network), continue to normal streaming
    }

    // Normal streaming chat
    // Placeholder for assistant reply that we'll fill in as chunks arrive
    const assistantIdx = newMessages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: newMessages.map(({ role, content }) => ({ role, content })) }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        let msg = `Server error ${resp.status}`;
        try {
          const text = await resp.text();
          try {
            const errBody = JSON.parse(text);
            if (errBody?.detail && typeof errBody.detail === "string") msg = errBody.detail;
          } catch {
            if (text) msg = text.slice(0, 200);
          }
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.chunk) {
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = {
                  ...copy[assistantIdx],
                  content: copy[assistantIdx].content + evt.chunk,
                };
                return copy;
              });
            }
            if (evt.done) {
              setModelSource(evt.model_source ?? "");
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = { ...copy[assistantIdx], streaming: false };
                return copy;
              });
            }
            if (evt.error) {
              setError(evt.error);
              setMessages((prev) => prev.slice(0, assistantIdx));
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Failed to reach the AI advisor. Please try again.");
        setMessages((prev) => prev.slice(0, assistantIdx));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming]);

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
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200",
          "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
          open && "scale-90 opacity-0 pointer-events-none",
        )}
        aria-label="Open AI advisor"
      >
        <MessageSquare className="h-6 w-6" />
        {!open && streaming && (
          <span className="absolute top-1 right-1 h-3 w-3 rounded-full bg-green-400 animate-pulse" />
        )}
      </button>

      {/* Panel */}
      <div
        className={cn(
          "fixed bottom-0 right-0 z-50 flex flex-col bg-background border-l border-t shadow-2xl transition-all duration-300 ease-in-out",
          "w-full sm:w-[440px] sm:rounded-tl-2xl",
          open ? "h-[600px] translate-y-0 opacity-100" : "h-0 translate-y-4 opacity-0 pointer-events-none",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 sm:rounded-tl-2xl">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">AI Financial Advisor</p>
              <div className="flex items-center gap-1 mt-0.5">
                {modelSource ? (
                  <SourceBadge source={modelSource} />
                ) : status?.active_backend === "none" ? (
                  <Badge variant="destructive" className="text-xs gap-1 py-0">
                    <WifiOff className="h-2.5 w-2.5" /> Unavailable
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {status?.active_backend === "ollama" ? "Local AI · Private" : "Ready"}
                  </span>
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
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
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
                  I have access to your accounts, transactions, and goals. Ask me anything.
                </p>
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
                  No AI backend available. Start Ollama or set ANTHROPIC_API_KEY.
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
                  "rounded-2xl px-3.5 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm",
                )}
              >
                {m.content}
                {m.streaming && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-current opacity-70 animate-pulse align-middle rounded-sm" />
                )}
                {m.pendingAction && m.actionStatus === "pending" && (
                  <div className="mt-3 space-y-2 border-t border-border/50 pt-2">
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
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (!m.pendingAction) return;
                          const mergedData = { ...m.pendingAction.data, ...m.editData };
                          executeAction(i, m.pendingAction.action_type, mergedData as Record<string, unknown>);
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
