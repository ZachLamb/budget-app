"""Modal deployment of vLLM serving Qwen 2.5 7B Instruct (AWQ 4-bit).

This is the prod side of Path C (Ollama in dev / Modal vLLM in prod) for
Tier 4 of Clarity's tiered LLM system. The endpoint speaks vLLM's
OpenAI-compatible API on /v1/chat/completions, gated by a shared-secret
Bearer token. Cold start ≈ 60–90s; once warm, ≈30–50 tok/s on A10G.

Deploy
    cd backend && PYTHONPATH=. .venv/bin/python -m pip install modal
    modal deploy infra/modal/vllm_app.py

Endpoint
    The deploy prints a public URL like
        https://zachlamb94--clarity-vllm-serve.modal.run
    Append /v1 for the OpenAI-compatible base, e.g.
        https://...modal.run/v1/chat/completions

Auth
    Set the Modal Secret ``clarity-vllm-api-key`` to a long random string
    (e.g. ``python -c "import secrets;print(secrets.token_urlsafe(48))"``).
    The vLLM server requires ``Authorization: Bearer <key>`` on every
    request. The FastAPI proxy reads ``LLM_BACKEND_API_KEY`` from its
    own env and sends it.

Cost guardrails
    - GPU spins up only when called; ``scaledown_window=300`` parks it
      after 5 minutes of idle. With sporadic household-scale usage,
      expect $5–20/month.
    - ``max_inputs=8`` per replica — vLLM batches concurrently inside a
      single container; Modal scales out replicas only when concurrency
      exceeds this.
    - Hard timeout of 600s on each request (a generation that hangs
      doesn't burn the budget indefinitely).
"""
from __future__ import annotations

import os
import subprocess

import modal

# ── Image ─────────────────────────────────────────────────────────────────────
# Pinned versions: changing these is a deliberate operational decision.
# vLLM 0.7.x is the first release with stable Qwen 2.5 AWQ support. CUDA 12.4
# matches Modal's A10G instance image.

VLLM_VERSION = "0.7.3"
HF_TRANSFER_VERSION = "0.1.9"
# vLLM 0.7.3 was built against transformers 4.48.x. Newer transformers 5.x
# dropped legacy tokenizer attributes (e.g. ``all_special_tokens_extended``)
# that vLLM still calls — pin to a known-good 4.x release until we move to
# vLLM 0.8+ which has updated bindings.
TRANSFORMERS_VERSION = "4.48.3"
HUGGINGFACE_HUB_VERSION = "0.27.1"  # last 0.x release; matches transformers 4.48 expectations

vllm_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.0-runtime-ubuntu22.04",
        add_python="3.12",
    )
    .pip_install(
        f"vllm=={VLLM_VERSION}",
        f"transformers=={TRANSFORMERS_VERSION}",
        f"huggingface_hub=={HUGGINGFACE_HUB_VERSION}",
        f"hf-transfer=={HF_TRANSFER_VERSION}",
    )
    # hf-transfer makes initial weight download ~3x faster; safe to leave on.
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)


# ── Model ─────────────────────────────────────────────────────────────────────
# Qwen 2.5 7B Instruct AWQ — Apache-2.0, ~4 GB on disk, strong at JSON-shape
# output (matters for Clarity's transaction categorization). If you swap to
# a different model later, also change MODEL_NAME and the model context window
# below; nothing else here is model-specific.

MODEL_NAME = "Qwen/Qwen2.5-7B-Instruct-AWQ"
MODEL_REVISION = "main"  # pin to a commit SHA before going production-serious
MAX_MODEL_LEN = 8192  # generation context window; 32k available but unused

# Shared HuggingFace cache so subsequent cold starts don't re-download weights.
hf_cache_vol = modal.Volume.from_name("clarity-hf-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("clarity-vllm-cache", create_if_missing=True)


# ── App ───────────────────────────────────────────────────────────────────────

app = modal.App("clarity-vllm")


# ``clarity-vllm-api-key`` is a Modal Secret you create once:
#   modal secret create clarity-vllm-api-key VLLM_API_KEY=<long-random-string>
# vLLM enforces the Bearer header internally; the FastAPI proxy reads the
# same value from its own env (``LLM_BACKEND_API_KEY``) and forwards it.
api_key_secret = modal.Secret.from_name(
    "clarity-vllm-api-key",
    required_keys=["VLLM_API_KEY"],
)


@app.function(
    image=vllm_image,
    gpu="A10G",
    secrets=[api_key_secret],
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
    # Idle for 5 min → tear down. Keeps the bill at zero between bursts.
    scaledown_window=300,
    # First-request timeout has to absorb cold-start (~90s) + generation.
    # Modal kills anything past this; vLLM internally has its own per-token
    # timeouts that fire much sooner.
    timeout=600,
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=8000, startup_timeout=180)
def serve():
    """Run vLLM's OpenAI-compatible HTTP server on port 8000.

    Modal exposes this on a public ``*.modal.run`` URL. ``--api-key`` makes
    every endpoint require ``Authorization: Bearer <key>`` — without that
    header, vLLM returns 401 before any GPU work happens.
    """
    api_key = os.environ["VLLM_API_KEY"]
    # argv list (NOT shell=True). Values that start with ``-`` (random
    # base64url tokens often do!) MUST use the ``--flag=value`` form,
    # otherwise vLLM's argparse rejects them as "another flag." That bit
    # us once already — see commit history.
    cmd = [
        "vllm", "serve", MODEL_NAME,
        f"--revision={MODEL_REVISION}",
        "--host=0.0.0.0",
        "--port=8000",
        f"--api-key={api_key}",
        f"--max-model-len={MAX_MODEL_LEN}",
        # Quantization is auto-detected from the model card, but be explicit
        # so we fail loudly if the card ever changes.
        "--quantization=awq",
        # vLLM phones home by default; privacy contract is "nothing about
        # our traffic should leak."
        "--disable-log-stats",
        "--disable-log-requests",
    ]
    # vLLM's CLI is itself an asyncio server; subprocess.Popen lets Modal's
    # @web_server probe the port for readiness while vLLM warms up.
    subprocess.Popen(cmd)
