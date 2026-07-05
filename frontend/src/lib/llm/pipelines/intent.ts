import api from "@/lib/api/client";
import { OnDeviceError } from "../errors";
import type { LLMProvider } from "../types";
import { buildIntentPrompt, buildIntentSystem, INTENT_SCHEMA } from "./intent-prompt";
import { generateStructured } from "./steps";

export interface DetectedIntent {
  action_type: string;
  data: Record<string, unknown>;
  confirmation_text: string;
}

const FIELD_KEYS = [
  "name",
  "group_name",
  "payee_match",
  "category_name",
  "account_name",
  "payee_name",
  "amount",
  "date",
  "memo",
] as const;

function extractData(raw: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    const val = raw[key];
    if (val !== undefined && val !== null && val !== "") {
      data[key] = val;
    }
  }
  return data;
}

export async function detectIntent(
  provider: LLMProvider,
  question: string,
  signal?: AbortSignal,
): Promise<DetectedIntent | null> {
  try {
    const raw = await generateStructured<Record<string, unknown>>(provider, {
      system: buildIntentSystem(),
      prompt: buildIntentPrompt(question),
      schema: INTENT_SCHEMA as unknown as Record<string, unknown>,
      signal,
    });
    const actionType = String(raw.action_type ?? "none");
    if (actionType === "none") return null;
    const confirmation = String(raw.confirmation_text ?? "").trim();
    if (!confirmation) return null;
    return {
      action_type: actionType,
      data: extractData(raw),
      confirmation_text: confirmation,
    };
  } catch {
    // Fail open to plain Q&A on parse/generation failures — but a user
    // cancel must propagate, not fall through into a second full pipeline.
    if (signal?.aborted) {
      throw new OnDeviceError("aborted", "Cancelled.");
    }
    return null;
  }
}

export interface PrepareActionResponse {
  ok: boolean;
  confirmation_token?: string | null;
  preview: string;
  normalized_data: Record<string, unknown>;
}

export async function prepareAction(
  actionType: string,
  data: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<PrepareActionResponse> {
  const r = await api.post<PrepareActionResponse>(
    "/ai/prepare-action",
    { action_type: actionType, data },
    { signal },
  );
  return r.data;
}
