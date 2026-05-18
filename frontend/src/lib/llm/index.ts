/**
 * Narrow public barrel for components that import from `@/lib/llm`.
 * Prefer direct module imports (`./useLlm`, `./router`, `./types`) in app code.
 */

export { LLMError, isLLMError } from "./providers/server";
export { scanPrompt } from "./pii-detect";
export type { PIIScan } from "./pii-detect";
