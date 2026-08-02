#!/usr/bin/env node
/**
 * Execute an exported job batch against a local OpenAI-compatible server.
 *
 *   node scripts/run-ai-jobs.mjs jobs.json results.json
 *
 * Options (env):
 *   LLM_BASE_URL   default http://127.0.0.1:1234/v1   (LM Studio; Ollama: :11434/v1)
 *   LLM_MODEL      default: the bundle's suggestedModel, else the server's first model
 *   LLM_API_TOKEN  optional bearer token (LM Studio 0.4.0+ with auth enabled)
 *   LLM_TIMEOUT_MS default 180000 — a cold JIT model load can take minutes
 *
 * Your data never leaves the machine: this talks only to LLM_BASE_URL.
 */

import { readFile, writeFile } from "node:fs/promises";

const JOBS_KIND = "snacksbudget.jobs";
const RESULTS_KIND = "snacksbudget.job_results";
const SCHEMA_VERSION = 1;

const BASE_URL = (process.env.LLM_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 180_000);
const TOKEN = process.env.LLM_API_TOKEN ?? "";

function headers() {
  const h = { "Content-Type": "application/json" };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function request(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Turn transport failures into something the user can act on. */
function explain(err) {
  if (err?.name === "AbortError") {
    return `Timed out after ${TIMEOUT_MS}ms. A cold model load can exceed this — raise LLM_TIMEOUT_MS.`;
  }
  if (err?.cause?.code === "ECONNREFUSED") {
    return `Nothing is listening at ${BASE_URL}. Start LM Studio and turn its local server on (Developer tab).`;
  }
  return err?.message ?? String(err);
}

async function resolveModel(preferred) {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  const res = await request("/models", { headers: headers() });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Server requires authentication (HTTP ${res.status}). Set LLM_API_TOKEN.`
        : `Could not list models (HTTP ${res.status}).`,
    );
  }
  const body = await res.json();
  const ids = (body.data ?? []).map((m) => m.id);
  if (ids.length === 0) {
    throw new Error("The server is running but has no model loaded. Load one and retry.");
  }
  if (preferred && ids.includes(preferred)) return preferred;
  return ids[0];
}

async function runJob(job, model) {
  const body = {
    model,
    messages: [
      { role: "system", content: job.system },
      { role: "user", content: job.prompt },
    ],
    temperature: 0.2,
    stream: false,
  };
  if (job.maxTokens) body.max_tokens = job.maxTokens;
  // Constrained decoding when the job carries a schema, so the output parses
  // with the same code path an in-browser run would use.
  if (job.responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "result", strict: true, schema: job.responseSchema },
    };
  }

  const res = await request("/chat/completions", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const payload = await res.json();
  const content = payload.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("Model returned an empty completion.");

  if (!job.responseSchema) return { output: content, model };
  try {
    return { output: JSON.parse(content), model };
  } catch {
    // Keep the raw text so the app (or Nano) can attempt a repair rather than
    // losing the work outright.
    return { output: content, model, error: "Model output was not valid JSON." };
  }
}

async function main() {
  const [, , inPath, outPath = "results.json"] = process.argv;
  if (!inPath) {
    console.error("Usage: node scripts/run-ai-jobs.mjs <jobs.json> [results.json]");
    process.exit(2);
  }

  const bundle = JSON.parse(await readFile(inPath, "utf8"));
  if (bundle.kind !== JOBS_KIND) {
    console.error(`Not a job bundle: expected kind "${JOBS_KIND}", got "${bundle.kind}".`);
    process.exit(2);
  }
  if (bundle.schemaVersion !== SCHEMA_VERSION) {
    console.error(`Unsupported schemaVersion ${bundle.schemaVersion}; this runner speaks ${SCHEMA_VERSION}.`);
    process.exit(2);
  }

  let model;
  try {
    model = await resolveModel(bundle.suggestedModel);
  } catch (err) {
    console.error(explain(err));
    process.exit(1);
  }

  const total = bundle.jobs.length;
  console.error(`Running ${total} job(s) on "${model}" at ${BASE_URL}`);

  const results = [];
  let failures = 0;
  for (const [i, job] of bundle.jobs.entries()) {
    process.stderr.write(`  [${i + 1}/${total}] ${job.feature}… `);
    try {
      const { output, model: used, error } = await runJob(job, model);
      results.push({ id: job.id, output, model: used, ...(error ? { error } : {}) });
      console.error(error ? `warn: ${error}` : "ok");
      if (error) failures++;
    } catch (err) {
      const message = explain(err);
      results.push({ id: job.id, error: message, model });
      console.error(`failed: ${message}`);
      failures++;
    }
  }

  await writeFile(
    outPath,
    JSON.stringify({ kind: RESULTS_KIND, schemaVersion: SCHEMA_VERSION, results }, null, 2),
    "utf8",
  );
  console.error(`\nWrote ${outPath} — ${total - failures}/${total} succeeded.`);
  console.error("Upload it in the app: Settings → Local AI handoff → Import results.");
  // Partial success still produces a usable file, so only a total wipeout is
  // worth a non-zero exit.
  process.exit(failures === total && total > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(explain(err));
  process.exit(1);
});
