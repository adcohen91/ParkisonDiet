# Avatar — Handoff Summary

## What Was Accomplished

### Backend (`backend/`)
- **`config.py`** — Pydantic Settings loading all `.env` vars (OpenRouter, Supabase, Pushover, admin password, owner name, session secret)
- **`database.py`** — Full Supabase CRUD layer: insert/fetch messages, single-round-trip `mark_conversation_read`, `list_conversations` summary builder
- **`agent/system_prompt.py`** — Builds system prompt from `knowledge/knowledge.md`, `style.md`, and `faq.jsonl` (using concise `query` field for FAQ routing)
- **`agent/tools.py`** — `faq_tool` and `push_tool` as proper `@function_tool` objects; `needs_attention_ctx` context var flags push events
- **`agent/runner.py`** — OpenAI Agents SDK configured for OpenRouter via `set_default_openai_client`; `run_agent_streaming()` yields typed SSE events (`text_delta`, `tool_start`, `tool_done`, `done`)
- **`routes/chat.py`** — Visitor endpoints: `GET /api/config`, `GET /api/conversations/{id}`, `GET /api/conversations/{id}/poll`, `POST /api/chat` (SSE stream, Qn instant answers, rate limiting, 20k-char truncation)
- **`routes/admin.py`** — Admin endpoints behind signed session cookie (itsdangerous): login/logout, list/get/post/resolve conversations
- **`main.py`** — FastAPI app serving both API and compiled frontend static files

### Frontend (`frontend/`)
- **Vite + TypeScript**, no framework
- **`index.html`** — Visitor chat: dark/light toggle, Keep chat cookie, Reset, name input, suggestion chips, streaming avatar bubbles, Qn instant-tag, typing indicator, mobile-responsive topbar
- **`admin.html`** — Admin: login gate → full dashboard with sidebar inbox, conversation thread, composer, filter chips, keyboard nav (↑/↓), **full mobile master/detail layout** (sidebar fills screen → tap conversation → thread fills screen → "← Inbox" back button returns to sidebar)
- **`src/visitor.ts`** — Full visitor logic: SSE stream parsing, tool-status rendering, Markdown renderer, polling (10s→60s), `?q=N` deep link, cookie management
- **`src/admin.ts`** — Full admin logic: auth check on load, conversation list, thread view, post-as-human, resolve, theme sync, mobile panel switching (`showInboxPanel` / `showThreadPanel`)
- Design system fully integrated: `tokens.css`, `components.css`, `icons.svg`, `avatar-robot-round.png`, `avatar-human.png`

### Infrastructure
- **`Dockerfile`** — Multi-stage: Node 22 builds Vite frontend, Python 3.12-slim runs FastAPI backend
- **`scripts/start_mac.sh`, `stop_mac.sh`** — Docker build + run with `.env`
- **`scripts/start_pc.ps1`, `stop_pc.ps1`** — PowerShell equivalents
- **`scripts/fly.toml`**, **`scripts/deploy.sh`** — Fly.io deployment (app `avatar-ed`, region `sjc`)
- **`scripts/wordpress-embed.html`** — iframe embed snippet with `?q=` passthrough

### Tests
- **28 backend pytest tests** — all passing: config, health, admin auth (wrong pw → 401, correct → 200 + cookie), chat routes (empty conv, poll, rate limit, truncation, Q1/Q2 instant answers)
- **13 Playwright tests** — all passing across desktop Chromium: dark/light theme, autofocus, theme toggle, chips, reset, Q1 instant answer, LLM streaming response (now working correctly), admin login/logout, conversation list, mobile layout

---

## Bugs Fixed in Latest Session

### 1. SSE Parse Bug in `routes/chat.py` — FIXED (critical)
**Issue:** The line that parsed runner SSE chunks used the wrong string slice:
```python
# BROKEN:
payload = json.loads(chunk[len("data: "):chunk.rstrip().rfind("\n\n") + 1].strip())
```
`chunk.rstrip()` removed the trailing `\n\n` before `rfind("\n\n")`, returning -1. The slice `chunk[6:0]` was always empty, so `json.loads` always threw. The `except` branch forwarded the runner's internal `{"event": ...}` format to the frontend, which expected `{"type": ...}` — so all streaming events were silently dropped and the avatar bubble stayed permanently empty.

**Fix:**
```python
# FIXED:
payload = json.loads(chunk[len("data: "):].rstrip())
```

This was the root cause of all streaming appearing broken (avatar never typed, bubble always empty).

### 2. Admin Mobile Layout — IMPLEMENTED
Added CSS media query `(max-width: 767px)` with `mob-inbox` / `mob-thread` workspace classes. On mobile:
- Inbox fills full screen by default
- Tapping a conversation shows thread (sidebar hidden), "← Inbox" back button appears
- Back button returns to inbox

CSS ordering fix: the `#mob-back` base style had `display: none` appearing AFTER the media query's `display: flex`, causing the media query to be overridden. Fixed by removing `display` from the base style block (controlled only by media queries).

### 3. Test Cleanup
- 8 test conversations deleted from Supabase
- Screenshots cleared

---

## Remaining Task

### Docker Build Test
Docker is not installed on the current development machine. The Dockerfile and build scripts are correct and ready. When Docker Desktop is available:
```bash
bash scripts/start_mac.sh   # builds and runs at localhost:8000
```
The multi-stage build (Node 22 for Vite, Python 3.12-slim for FastAPI) is straightforward; no known issues.

### Fly.io Deploy (optional)
`scripts/deploy.sh` and `scripts/fly.toml` are ready. Requires `flyctl` login and production secrets set via `fly secrets set`.

---

## Running the App Locally

```bash
# Backend dev server (hot-reload)
cd backend && uv run uvicorn main:app --reload --port 8000

# Frontend dev server (with proxy to backend)
cd frontend && npm run dev   # http://localhost:5173

# Build frontend for backend to serve
cd frontend && npm run build

# Backend tests
cd backend && uv run pytest tests/ -v

# Playwright tests (backend must be running on :8000)
cd test && npx playwright test --project=chromium-desktop

# Docker (requires Docker)
bash scripts/start_mac.sh    # builds + runs container at localhost:8000
bash scripts/stop_mac.sh
```
