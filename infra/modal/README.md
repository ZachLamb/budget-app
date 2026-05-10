# Modal vLLM (Tier 4 prod backend)

Production deploy of Qwen 2.5 7B Instruct (AWQ 4-bit) on Modal, serving
Clarity's Tier 4 (cloud) AI. Local dev still uses Ollama from the Docker
Compose stack — both speak the same OpenAI-compatible `/v1/chat/completions`
shape, so the FastAPI proxy points at one or the other via a single env var.

## One-time setup

1. **Modal account.** Sign up at <https://modal.com>, then locally:
   ```sh
   pip install modal
   modal token new
   ```

2. **Create the API-key Secret.** vLLM requires `Authorization: Bearer <key>`
   on every request. Generate a strong random value and store it as a Modal
   Secret named `clarity-vllm-api-key`:
   ```sh
   KEY=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
   modal secret create clarity-vllm-api-key VLLM_API_KEY="$KEY"
   echo "Save this — you'll set LLM_BACKEND_API_KEY on the FastAPI side: $KEY"
   ```

3. **Deploy.**
   ```sh
   modal deploy infra/modal/vllm_app.py
   ```
   The first deploy builds the image (downloads CUDA + vLLM wheels) — give it
   ~3–5 minutes. Subsequent deploys are seconds when only the function body
   changed. Modal prints the public URL; save it for the next step.

4. **Smoke-test the endpoint.**
   ```sh
   LLM_BACKEND_URL=https://<your-modal-url>.modal.run \
   LLM_BACKEND_API_KEY="$KEY" \
       python infra/modal/smoke_test.py
   ```
   Cold start: ~60–90s. Warm: <2s.

## Production cutover

The FastAPI backend reads two env vars:

| Var | Value |
|---|---|
| `LLM_BACKEND_URL` | The Modal URL printed by `modal deploy`. |
| `LLM_BACKEND_API_KEY` | The same string you stored in the Modal Secret. |

Set both on your prod backend host (Fly, Railway, your VPS, wherever
docker-compose runs). On startup the FastAPI proxy uses these for every
Tier 4 call. Existing `OLLAMA_URL` keeps working as a fallback for local dev.

## Cost expectations

- **GPU:** A10G, ~$1.10/hr while running.
- **Scale to zero:** the container parks after 5 minutes of idle.
- **Sporadic household-scale usage:** expect $5–20/month total.
- **Hard limits in code:**
  - `scaledown_window=300` (5 min idle teardown).
  - `max_inputs=8` per replica (vLLM batches; Modal scales out only past 8
    concurrent calls).
  - `timeout=600` (10 min ceiling per request — a hung generation can't
    burn the bill).

The FastAPI proxy adds further per-user (50/day) and global (cost circuit
breaker) ceilings — see `app/services/ai/llm_rate_limit.py` and
`app/services/ai/circuit.py`.

## Updating the model

Edit `MODEL_NAME` and `MODEL_REVISION` in `vllm_app.py`, then `modal deploy`.
The HuggingFace cache volume (`clarity-hf-cache`) survives across deploys, so
unchanged models load instantly. To purge it:
```sh
modal volume delete clarity-hf-cache
modal volume create clarity-hf-cache
```

## Privacy / operational notes

- vLLM's request logging is disabled (`--disable-log-requests`,
  `--disable-log-stats`) so no prompt content lands in Modal's logs.
- `disable_log_stats` also turns off vLLM's outbound usage telemetry. Modal
  itself collects function-execution metadata (duration, GPU time) but not
  request bodies.
- The endpoint is public-by-URL but unusable without the Bearer key. Rotate
  the key periodically: regenerate the Modal Secret and the FastAPI env
  var in lockstep, then `modal deploy` to pick up the new secret value.

## Rollback

If a deploy goes bad, deploy the previous version:
```sh
git checkout <previous-commit> -- infra/modal/vllm_app.py
modal deploy infra/modal/vllm_app.py
git checkout HEAD -- infra/modal/vllm_app.py
```
Or just point `LLM_BACKEND_URL` back at Ollama (or unset it — proxy treats
absence as "Tier 4 unavailable" and the cloud routes will return clear
errors).
