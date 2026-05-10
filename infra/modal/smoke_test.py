"""Smoke-test the deployed Modal vLLM endpoint.

Usage (pass the URL printed by ``modal deploy`` and the secret value):

    LLM_BACKEND_URL=https://...modal.run \
    LLM_BACKEND_API_KEY=<the-VLLM_API_KEY-secret-value> \
        python infra/modal/smoke_test.py

What it does
    - Calls /v1/chat/completions with a tiny prompt.
    - Asserts a streaming response with at least one non-empty content chunk.
    - Prints latency + token rate.

Fails with a clear message on any of: 401 (auth wrong), 502 (vLLM not ready),
empty stream (model server bug), or wall-clock > 120s (cold start exceeded
expected window).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request


# Modal returns HTTP 303 with a redirect query (``__modal_function_call_id``)
# while a function is warming up. Standard HTTP semantics for 303 say
# "switch to GET on the redirect target," but Modal expects the same POST
# replayed at the redirect URL. urllib doesn't honor that; we redirect by hand.
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _post(url: str, body: bytes, headers: dict[str, str], timeout: int):
    """POST that re-posts (same method + body) on Modal-style 303 redirects."""
    seen: set[str] = set()
    current = url
    for _ in range(5):
        if current in seen:
            raise RuntimeError(f"Redirect loop at {current}")
        seen.add(current)
        req = urllib.request.Request(current, data=body, headers=headers, method="POST")
        try:
            return _OPENER.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code == 303 and e.headers.get("Location"):
                # Modal cold-start: re-POST at the new URL with the same body.
                # Brief sleep gives vLLM a chance to finish booting.
                current = e.headers["Location"]
                time.sleep(2)
                continue
            raise
    raise RuntimeError("Too many redirects")


def _require_env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.stderr.write(f"ERROR: {name} must be set in the environment\n")
        sys.exit(2)
    return v


def main() -> int:
    base = _require_env("LLM_BACKEND_URL").rstrip("/")
    api_key = _require_env("LLM_BACKEND_API_KEY")
    url = f"{base}/v1/chat/completions"

    body = json.dumps(
        {
            "model": "Qwen/Qwen2.5-7B-Instruct-AWQ",
            "messages": [
                {"role": "system", "content": "Reply in one short sentence."},
                {"role": "user", "content": "What is 2+2? Answer in one sentence."},
            ],
            "stream": True,
            "max_tokens": 32,
            "temperature": 0.0,
        }
    ).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "Accept": "text/event-stream",
    }

    t0 = time.perf_counter()
    print(f"POST {url} (streaming)…")
    try:
        # Generous timeout for cold start.
        with _post(url, body, headers, timeout=180) as resp:
            if resp.status != 200:
                sys.stderr.write(f"HTTP {resp.status}\n")
                return 1
            chunks: list[str] = []
            first_token_t: float | None = None
            for raw_line in resp:
                line = raw_line.decode("utf-8").rstrip("\n").rstrip("\r")
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                delta = event.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    if first_token_t is None:
                        first_token_t = time.perf_counter()
                    chunks.append(delta)
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"HTTPError {e.code}: {e.read().decode('utf-8', errors='replace')[:400]}\n")
        return 1
    except urllib.error.URLError as e:
        sys.stderr.write(f"URLError: {e}\n")
        return 1

    total = time.perf_counter() - t0
    text = "".join(chunks).strip()
    if not text:
        sys.stderr.write("ERROR: empty stream — vLLM produced no content\n")
        return 1

    ttft = first_token_t - t0 if first_token_t else float("nan")
    n_chars = len(text)
    print(f"OK — {n_chars} chars in {total:.1f}s (TTFT {ttft:.1f}s)")
    print(f"reply: {text!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
