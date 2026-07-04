import { buildQaPrompt, buildQaSystem } from "../../frontend/src/lib/llm/pipelines/qa-prompt";
import facts from "../fixtures/household-edge.json";

export default function qaEdgePrompt({ vars }: { vars: Record<string, string> }) {
  const known = ["g-empty"];
  return [
    { role: "system", content: buildQaSystem() },
    {
      role: "user",
      content: buildQaPrompt(vars.question, known, JSON.stringify(facts), []),
    },
  ];
}
