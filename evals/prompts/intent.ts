import { buildIntentPrompt, buildIntentSystem, INTENT_SCHEMA } from "../../frontend/src/lib/llm/pipelines/intent-prompt";

export default function intentPrompt({ vars }: { vars: Record<string, string> }) {
  return [
    { role: "system", content: buildIntentSystem() },
    { role: "user", content: buildIntentPrompt(vars.question) },
  ];
}

export { INTENT_SCHEMA };
