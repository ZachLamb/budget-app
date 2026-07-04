import { buildQaPrompt, buildQaSystem } from "../../frontend/src/lib/llm/pipelines/qa-prompt";
import facts from "../fixtures/household-small.json";

export default function qaPrompt({ vars }: { vars: Record<string, string> }) {
  const known = ["c-fees", "a-checking", "a-visa", "g-efund", "c-dining"];
  return [
    { role: "system", content: buildQaSystem() },
    {
      role: "user",
      content: buildQaPrompt(vars.question, known, JSON.stringify(facts), []),
    },
  ];
}
