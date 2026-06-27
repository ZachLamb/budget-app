/**
 * Narrow public barrel for components that import from `@/lib/llm`.
 * Prefer direct module imports (`./useLlm`, `./router`, `./types`) in app code.
 */

export { userMessageFor, OnDeviceError } from "./errors";
export type { OnDeviceErrorCode } from "./errors";
