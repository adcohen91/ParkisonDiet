# ParkinsonDiet — Full Application Specification

This document describes the complete, correct state of the ParkinsonDiet application: what has been built, what needs to be fixed, and the exact changes required. It is the authoritative reference for the current session and any future build sessions.

---

## 1. What Has Been Built

The application is a diet tool forParkinson's patients and caregivers.
A LLM using the contents of knowledge/InitialDiet.md
A html screen is built from the returned results which will look like meal-plan.html updated from the results of the LLM



### Tech Stack
- **Backend:** Python 3.12, FastAPI, `uv` package manager
- **LLM:** OpenAI Agents SDK routed through either OpenAI directly or OpenRouter
- **Storage:** In-memory (`defaultdict(list)`) — no Supabase in the current build
- **Frontend:** Vanilla TypeScript + Vite (no framework)
- **Fonts:** Playfair Display (headings) + Source Sans 3 (UI)
- **Palette:** Warm/sage — cream `#faf7f2`, sage `#7a9e7e`, accent/terracotta `#c4713b`

---

## 2. Design System

Light-only. No dark mode. No design-system tokens.css or components.css — each HTML file is fully self-contained with inline `<style>`.

### Color Tokens (CSS custom properties — same in both HTML files)
```css
:root {
  --sage:         #7a9e7e;
  --sage-light:   #b5cdb7;
  --sage-dark:    #4a6b4e;
  --cream:        #faf7f2;
  --warm:         #f0e8d5;
  --text:         #2a2a2a;
  --muted:        #6b6b6b;
  --accent:       #c4713b;
  --accent-light: #f2dcc8;
  --white:        #ffffff;
  --border:       #e4ddd2;
  --blue-token:   #2a6a85;
  --blue-soft:    #ddeef5;
  --blue-border:  #a8cfdf;
}
```

### Typography
- **Headings / brand:** `'Playfair Display', serif`
- **All UI text:** `'Source Sans 3', sans-serif`
- Both loaded from Google Fonts (preconnect + stylesheet link in `<head>`)

#
## 3. Files — Current Correct State

### `frontend/index.html` — Visitor chat UI
Complete self-contained file. Key structural elements:

```
<header class="topbar">
  .brand > .brand-mark (sage circle, shield SVG) + div > .brand-name + .brand-sub#brand-sub
  .name-wrap > SVG person icon + input#visitor-name
  button.reset-btn#reset-btn "New chat"
</header>

<main class="chat-area" id="chat-area">
  <div class="chat-inner" id="chat-inner">
    <div class="intro" id="intro">
      .intro-icon (sage circle, shield SVG)
      h1 "Your Parkinson's Diet Planner"
      p (description)
      .chips > 4× button.chip[data-msg="..."]
    </div>
    <div class="typing" id="typing">
      3× <span class="dot">
    </div>
  </div>
</main>

<footer class="composer-bar">
  .composer-wrap > .composer > textarea#msg-input + button.send-btn#send-btn
  p.composer-hint
</footer>



## 4. Backend — Current Correct State

### `backend/config.py`
```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openrouter_api_key: str = ""
    model: str = "openai/gpt-5.4-nano"
    owner_name: str = "Aaron Cohen"
    admin_password: str = "changeme"
    pushover_user: str = ""
    pushover_token: str = ""
    session_secret: str = "dev-secret-change-in-prod"
    cookie_secure: bool = False
```

### `backend/database.py`
In-memory store using `defaultdict(list)`. Functions:
- `save_message(conv_id, role, content, visitor_name)` — appends `{role, content, visitor_name, created_at}` to `_messages[conv_id]`
- `get_messages(conv_id)` → full list
- `get_new_messages(conv_id, since_iso)` → messages where `created_at > since_iso`
- `set_needs_attention(conv_id)` — sets flag on conversation
- `list_conversations()` → summary list for admin inbox

### `backend/agent/runner.py`
Current state — routes all calls to OpenRouter endpoint regardless of key type.

### `backend/routes/chat.py`
SSE stream for LLM responses. Rate limited (20/min per conv_id). Instant `Qn` answers skip LLM.

---

## 5. Known Bugs & Required Fixes

### Fix 1 — Wrong API key / endpoint mismatch (CRITICAL — app cannot chat)

**Root cause:**  
`.env` contains `OPENROUTER_API_KEY=sk-proj-vM36...` — this is an **OpenAI direct project key** (164 chars, prefix `sk-proj-`). The backend sends it to `https://openrouter.ai/api/v1`, which rejects it with HTTP 401 "Missing Authentication header". OpenRouter only accepts its own keys (`sk-or-v1-...`).

**Symptom:**  
Chat SSE stream opens (HTTP 200) then closes immediately with no data. Frontend shows "Connection error."

**Two options to fix — choose one:**

#### Option A — Use OpenAI directly (no OpenRouter account needed)
Change `backend/agent/runner.py` `_init_openrouter()` to detect key type:

```python
def _init_openrouter() -> None:
    global _initialised
    if _initialised:
        return
    s = get_settings()
    key = s.openrouter_api_key

    if key.startswith("sk-or-"):
        # OpenRouter key
        base_url = "https://openrouter.ai/api/v1"
    else:
        # OpenAI direct key
        base_url = "https://api.openai.com/v1"

    client = AsyncOpenAI(base_url=base_url, api_key=key)
    set_default_openai_client(client)
    set_tracing_disabled(True)
    _initialised = True
```

Also fix the model name in `config.py` — `openai/gpt-5.4-nano` does not exist on OpenAI direct. Change default to a real model:

```python
# For OpenAI direct:
model: str = "gpt-4o-mini"

# For OpenRouter (keeps provider prefix):
model: str = "openai/gpt-4o-mini"
```

And in `runner.py` `run_agent_streaming()`, strip the `openai/` prefix when using direct OpenAI:

```python
model_name = s.model
if not key.startswith("sk-or-") and model_name.startswith("openai/"):
    model_name = model_name[len("openai/"):]

agent = Agent(
    name=f"{s.owner_name} Digital Twin",
    model=model_name,
    ...
)
```

#### Option B — Get a real OpenRouter key
1. Sign up at `https://openrouter.ai`
2. Create an API key (will start with `sk-or-v1-`)
3. Replace in `.env`: `OPENROUTER_API_KEY=sk-or-v1-<your-key>`
4. Set a real model: `MODEL=openai/gpt-4o-mini`
5. No code changes needed

---

### Fix 2 — Silent stream failure gives "Connection error" instead of a helpful message

**Root cause:**  
`llm_stream()` in `backend/routes/chat.py` has no exception handling. When the agent runner throws (e.g., 401 from LLM), the generator exits silently. The SSE stream closes without sending any event, so the frontend reader loop exits on `done=True` with no bubble rendered, then the `if (!bubble)` fallback fires — but only if the stream closes cleanly. If it closes abruptly, the outer `catch` fires and shows "Connection error."

**Fix — `backend/routes/chat.py` `llm_stream()` function:**

Replace:
```python
async def llm_stream():
    accumulated = ""
    try:
        async for event in run_agent_streaming(
            history, message, visitor_name, needs_attention_flag
        ):
            accumulated += event.get("delta", "")
            yield f"data: {json.dumps(event)}\n\n"
    finally:
        if accumulated:
            await db.save_message(conv_id, "ai", accumulated, visitor_name)
        if needs_attention_flag["needs_attention"]:
            await db.set_needs_attention(conv_id)
```

With:
```python
async def llm_stream():
    accumulated = ""
    try:
        async for event in run_agent_streaming(
            history, message, visitor_name, needs_attention_flag
        ):
            accumulated += event.get("delta", "")
            yield f"data: {json.dumps(event)}\n\n"
    except Exception as exc:
        error_msg = "I'm sorry, I encountered a problem. Please try again."
        yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    finally:
        if accumulated:
            await db.save_message(conv_id, "ai", accumulated, visitor_name)
        if needs_attention_flag["needs_attention"]:
            await db.set_needs_attention(conv_id)
```

---

### Fix 3 — Frontend does not handle `error` SSE event type

**Root cause:**  
`frontend/src/visitor.ts` SSE parsing loop does not handle `ev.type === 'error'`.

**Fix — in the SSE parsing `for` loop inside `sendMessage()`:**

Add after the `done` branch:
```typescript
} else if (ev.type === 'error') {
    appendAiMsg(ev.message || "Sorry, something went wrong. Please try again.")
}
```

Full corrected block:
```typescript
if (ev.type === 'instant') {
    appendAiMsg(
        `**${ev.question || ''}**\n\n${ev.content || ev.message || ''}`,
        true, ev.tag ? `Q${ev.tag}` : ''
    )
} else if (ev.type === 'text_delta') {
    if (!bubble) bubble = createStreamingBubble()
    bubble.update(ev.delta)
} else if (ev.type === 'tool_start') {
    if (!bubble) bubble = createStreamingBubble()
    toolDone = bubble.addTool(ev.tool)
} else if (ev.type === 'tool_done') {
    if (toolDone) { toolDone(); toolDone = null }
} else if (ev.type === 'error') {
    appendAiMsg(ev.message || "Sorry, something went wrong. Please try again.")
} else if (ev.type === 'done') {
    if (bubble) bubble.finish()
}
```

---

## 6. Environment Variables (`.env`)

Required keys and their correct values for local dev:

```
# LLM — use ONE of the following:
OPENROUTER_API_KEY=sk-proj-<your-openai-key>   # OpenAI direct (needs Fix 1 Option A)
OPENROUTER_API_KEY=sk-or-v1-<your-key>         # OpenRouter (needs Fix 1 Option B)

# Model — must match key type:
MODEL=gpt-4o-mini                              # OpenAI direct (no provider prefix)
MODEL=openai/gpt-4o-mini                      # OpenRouter (provider/model format)

# Owner
OWNER_NAME=Aaron Cohen

# Admin
ADMIN_PASSWORD=<your-password>
SESSION_SECRET=<random-32-char-string>

# Pushover (optional — leave blank to disable push notifications)
PUSHOVER_USER=
PUSHOVER_TOKEN=

# Cookie
COOKIE_SECURE=0    # 0 for local HTTP dev; 1 for production HTTPS

# Supabase (not used in current in-memory build — leave blank or omit)
SUPABASE_URL=
SUPABASE_KEY=
```

---

## 7. API Endpoints Reference

### Visitor endpoints (`backend/routes/chat.py`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Returns `{"owner_name": "..."}` |
| POST | `/api/chat` | SSE stream; body: `{message, visitor_name}` |
| GET | `/api/conversations/{id}` | Full message history for a conversation |
| GET | `/api/conversations/{id}/poll?since=` | New messages since ISO timestamp |

### Admin endpoints (`backend/routes/admin.py`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/login` | None | Body: `{password}` → sets httpOnly session cookie |
| GET | `/admin/me` | Cookie | 200 if authenticated |
| POST | `/admin/logout` | Cookie | Clears session |
| GET | `/admin/conversations` | Cookie | List of all conversations |
| GET | `/admin/conversations/{id}` | Cookie | Thread messages |
| POST | `/admin/conversations/{id}/message` | Cookie | Post as human owner; body: `{content, visitor_name}` |

---

## 8. SSE Event Schema

All events are `data: <json>\n\n` lines.

| `type` | Fields | When |
|---|---|---|
| `instant` | `content`, `question?`, `tag?` | Qn quick answer (no LLM) |
| `text_delta` | `delta` (string) | Streaming token from LLM |
| `tool_start` | `tool` (name string) | Tool call started |
| `tool_done` | — | Tool call completed |
| `error` | `message` (user-visible string) | LLM/agent threw an exception |
| `done` | — | Stream complete |

---

## 9. Conversation Roles

| DB `role` value | Maps to LLM role | Frontend class |
|---|---|---|
| `"visitor"` | `"user"` | `.msg--visitor` |
| `"ai"` | `"assistant"` | `.msg--ai` |
| `"human"` | injected as `"user"` with `[Message from {owner_name}]:` prefix | `.msg--human` |

When the human owner posts from admin, the AI does NOT auto-reply. The human message is stored and surfaced to the AI on the visitor's next submission (included in history passed to `run_agent_streaming()`).

---

## 10. Key Behaviours

- **Qn instant answers:** message matches `/^q\d{1,2}$/i` → skip LLM, return FAQ answer tagged `instant`. Answer stored with role `"ai"`.
- **Rate limiting:** 20 messages/minute per `conversation_id` (in-memory `MovingWindowRateLimiter`). Returns HTTP 429.
- **Message truncation:** visitor input >20,000 chars is truncated; note appended to truncated text before storing and sending.
- **`OWNER_NAME`:** always from `.env`/config via `GET /api/config`; never hardcoded in UI. Frontend fetches on init.
- **Conversation ID:** stored in `localStorage['pd-conv-id']`. Visitor gets same thread across page reloads.
- **Polling:** visitor polls `/poll` every 10s; slows to 60s after 5 minutes of inactivity. Only renders `human`-role messages from poll results (avoids re-rendering AI messages that arrived via SSE).

---

## 11. Build & Run

```bash
# Backend (hot-reload)
cd backend && uv run uvicorn main:app --reload --port 8000

# Frontend (dev server proxies /api/* to :8000)
cd frontend && npm run dev        # http://localhost:5173

# Build frontend into backend/static for production
cd frontend && npm run build

# Run all backend tests
cd backend && uv run pytest tests/ -v

# Docker (Mac)
bash scripts/start_mac.sh    # stop → rebuild → run at localhost:8000
bash scripts/stop_mac.sh
```

Use `MODEL=gpt-4o-mini` (or `openai/gpt-4o-mini` for OpenRouter) during testing to minimise cost.
