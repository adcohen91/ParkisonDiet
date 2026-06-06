# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ParkinsonDiet is a web application for Parkinson's patients, caregivers, and medical professionals to build personalized meal plans, recipes, and shopping lists. It is a digital-twin style app: a visitor chats with an AI assistant (the Avatar), and the human owner can silently join from `/admin`. The full spec is in `SPEC.md`; reference output UI is in `meal-plan.html` and `_!DOCTYPE.txt`.

## Tech Stack

- **Backend:** Python 3.12, FastAPI, `uv` package manager, OpenAI Agents SDK (via OpenRouter), Supabase (Postgres via REST)
- **Frontend:** Vanilla TypeScript + Vite (no framework)
- **LLM:** OpenRouter (`openai/gpt-5.4-nano` for dev/test, `openai/gpt-5.4-mini` for production) — configured via `MODEL` in `.env`
- **Deployment:** Single Docker container (multi-stage build); deployment target is AWS (credentials in `.env`)

## Environment Variables

All configuration lives in `.env` at the repo root. Required keys:

```
AWS_ACCESS_KEY_ID, OPENROUTER_API_KEY, MODEL, OWNER_NAME,
ADMIN_PASSWORD, PUSHOVER_USER, PUSHOVER_TOKEN,
SUPABASE_URL, SUPABASE_KEY, SESSION_SECRET, COOKIE_SECURE
```

`COOKIE_SECURE=0` for local dev (HTTP); `COOKIE_SECURE=1` for production (HTTPS).

## Development Commands

```bash
# Backend dev server (hot-reload, from repo root)
cd backend && uv run uvicorn main:app --reload --port 8000

# Frontend dev server (proxies API to :8000)
cd frontend && npm run dev        # http://localhost:5173

# Build frontend for backend to serve
cd frontend && npm run build

# Backend tests
cd backend && uv run pytest tests/ -v

# Connectivity check (run before anything else)
cd backend && uv run pytest tests/test_supabase_connection.py -v

# Playwright tests (backend must be running on :8000)
cd test && npx playwright test --project=chromium-desktop

# Docker (Mac)
bash scripts/start_mac.sh         # stop → rebuild → run at localhost:8000
bash scripts/stop_mac.sh

# Deploy to AWS
scripts/deploy.sh
```

## Architecture

### Backend (`backend/`)

- **`config.py`** — Pydantic Settings loading all `.env` vars
- **`database.py`** — Supabase CRUD: insert/fetch messages, `mark_conversation_read`, `list_conversations`
- **`agent/system_prompt.py`** — Builds the LLM system prompt from `knowledge/knowledge.md`, `knowledge/style.md`, and `knowledge/faq.jsonl`
- **`agent/tools.py`** — `faq_tool` and `push_tool` as `@function_tool` objects
- **`agent/runner.py`** — OpenAI Agents SDK configured for OpenRouter via `set_default_openai_client`; `run_agent_streaming()` yields typed SSE events (`text_delta`, `tool_start`, `tool_done`, `done`)
- **`routes/chat.py`** — Visitor endpoints: `/api/config`, `/api/conversations/{id}`, `/api/conversations/{id}/poll`, `/api/chat` (SSE stream, `Qn` instant answers, rate limiting, 20k-char truncation)
- **`routes/admin.py`** — Admin endpoints behind signed httpOnly session cookie (`itsdangerous`)
- **`main.py`** — FastAPI app; serves API + compiled frontend static files

### Frontend (`frontend/`)

- **`index.html`** — Visitor chat UI
- **`admin.html`** — Admin login gate + dashboard (sidebar inbox + thread view)
- **`src/visitor.ts`** — SSE stream parsing, tool-status rendering, Markdown, polling (10s → 60s after 5 quiet minutes), `?q=N` deep link, cookie management
- **`src/admin.ts`** — Auth check, conversation list, thread view, post-as-human, mobile panel switching

### Design System (`design-system/`)

Visual and interaction system produced by Claude Design. **SPEC.md governs behaviour; `design-system/` governs appearance.** When they conflict, SPEC wins on behaviour, design-system wins on appearance.

- `tokens.css` — Single source of truth for all design tokens (dark + light themes via `data-theme` on `<html>`). Dark is default.
- `components.css` — Build-ready component classes (depends on `tokens.css`)
- `icons.svg` — Icon sprite, used as `<use href="icons.svg#i-...">`
- `mockups/` — Hi-fi reference screens for both visitor and admin UIs — the literal build targets

**Design rules:** Dark-first navy surfaces; Newsreader (display) + Hanken Grotesk (UI) + JetBrains Mono. Blue-led identity, yellow reserved for the human-in-the-loop, purple locked to primary actions only. No gradients in chrome, no purple wash, no left-edge accent bars, no emoji. All colours must come from tokens — never invent hex values.

### Knowledge (`knowledge/`)

- `knowledge.md` — Rich first-person profile of the owner (Aaron D. Cohen)
- `style.md` — Owner's voice, formatting rules, and safety guidelines
- `faq.jsonl` — FAQ rows with `query` (short phrasing for routing), `question`, and `answer`
- `pic.jpg` — Owner's photo; used as the human photo in the UI (`owner.jpg` in `frontend/public/`)

### Three-Role Conversation Model

| Role | Bubble class | Identity |
|---|---|---|
| Visitor | `.msg--visitor` | Blue initials token (`.initials`), right-aligned |
| AI | `.msg--ai` | Cyan initials token (`.initials--ai`), left-aligned |
| Human (owner from `/admin`) | `.msg--human` | `owner.jpg` photo (`.photo-human`), yellow ring + glow, left-aligned |

When the human posts from admin, the AI does NOT respond. The human's message is stored and surfaced to the AI on the visitor's next submission.

### Key Behaviours

- **`Qn` instant answers:** if a visitor message matches `^q\d{1,2}$`, skip the model and return the FAQ answer directly, tagged `.instant-tag`
- **Polling:** visitor frontend polls `/api/conversations/{id}/poll` every 10s, slowing to 60s after 5 minutes of inactivity
- **Rate limiting:** 20 messages/minute per `conversation_id` (in-memory); returns HTTP 429 before any LLM call
- **Message truncation:** visitor input >20,000 chars is truncated with a note appended, then stored and sent to the LLM
- **Admin auth:** `POST /admin/login` with `ADMIN_PASSWORD` → signed httpOnly session cookie guards all `/admin/*` routes
- **`OWNER_NAME`** is always read from `.env` / config — never hardcoded in the UI

## Docker Build

Multi-stage Dockerfile: Node 22 builds the Vite frontend; Python 3.12-slim runs the FastAPI backend. `scripts/start_mac.sh` stops any running container, rebuilds, and runs at `localhost:8000`. The `.env` file is bind-mounted at runtime (never baked into the image).

## Testing

1. **Backend unit tests** (`cd backend && uv run pytest tests/ -v`) — must cover admin auth routes (wrong password → 401, correct → 200 + cookie), chat routes, rate limiting, truncation, and `Qn` instant answers
2. **Playwright tests** (`cd test && npx playwright test --project=chromium-desktop`) — cover both themes, both screens, streaming, mobile layout; capture screenshots
3. **Docker end-to-end** — build with `start_mac.sh` and run the full three-way flow

Use `MODEL=openai/gpt-5.4-nano` during testing to minimize cost. Delete test screenshots and Supabase test threads after testing.

## Reference Files

- `SPEC.md` — Full product specification and Q&A
- `DEPLOY.md` — AWS/Fly.io deployment guide
- `HANDOFF.md` — Session handoff summary (what's built, bugs fixed, what's remaining)
- `meal-plan.html` / `_!DOCTYPE.txt` — Reference output UI (the target look for generated meal plans)
- `ParkinsonDiet.html` — Example top-of-page application UI
