# ParkinsonDiet — Test Plan

## Backend Tests

Run: `cd backend && uv run pytest tests/ -v`

### Auth (test_admin.py)
- [x] Unauthenticated requests to all `/admin/*` routes return 401
- [x] Login with wrong password returns 401
- [x] Login with correct password returns 200 and sets `admin_session` cookie
- [x] `/admin/me` returns 200 when authenticated
- [x] Logout clears session; subsequent `/admin/me` returns 401

### Conversations — Admin (test_admin.py)
- [ ] `GET /admin/conversations` returns conversation list
- [ ] `GET /admin/conversations/{id}` returns empty list for unknown ID
- [ ] `POST /admin/conversations/{id}/message` with empty content returns 400
- [ ] `POST /admin/conversations/{id}/message` stores a human-role message

### Chat Routes (test_chat.py)
- [x] `GET /api/config` returns `owner_name`
- [x] `POST /api/chat` with empty message returns 400
- [x] `POST /api/chat` with whitespace-only message returns 400
- [x] `GET /api/conversations/{id}` returns 200 with empty list for unknown ID
- [x] `GET /api/conversations/{id}/poll` returns 200 with empty list

### Abuse Guards (test_chat.py)
- [ ] Rate limit: 21st message in one minute from same conversation_id returns 429
- [ ] Instant Q1 answer returns `"type":"instant"` SSE event (no LLM call)
- [ ] Message over 20,000 chars is accepted (truncated internally)

---

## Visitor UI Checklist (manual / Playwright)

- [ ] Page loads in dark mode by default
- [ ] Theme toggle switches to light mode and persists via localStorage
- [ ] Intro screen shows AI image, title, description, and suggestion chips
- [ ] Clicking a chip populates the composer and sends the message
- [ ] Visitor name field appears in topbar; name is sent with messages
- [ ] Composer auto-focuses on load
- [ ] Enter sends message; Shift+Enter adds newline
- [ ] Sent message appears as visitor bubble (right-aligned, blue initials)
- [ ] Typing indicator (three dots) appears while awaiting response
- [ ] Avatar response streams in real time as text_delta events arrive
- [ ] Tool-status lines appear and update to "done" when tool calls complete
- [ ] `Q1` returns an instant answer tagged "instant"
- [ ] `?q=1` in URL auto-sends Q1 on load
- [ ] Keep chat toggle: turning off clears conversation and starts fresh
- [ ] Reset button clears conversation
- [ ] Human messages appear with yellow ring and "live" tag

---

## Admin UI Checklist (manual / Playwright)

- [ ] `/admin` shows login gate
- [ ] Wrong password shows error message
- [ ] Correct password redirects to dashboard
- [ ] Conversation inbox lists conversations, most recent first
- [ ] Unread conversations show blue dot
- [ ] Conversations needing attention show yellow "Needs you" badge
- [ ] Clicking a conversation loads the thread
- [ ] Thread shows all three role types correctly (visitor, AI, human)
- [ ] Admin composer: Enter sends, Shift+Enter adds newline
- [ ] Posting as human stores a `human`-role message visible in thread
- [ ] `↑/↓` arrow keys navigate conversations
- [ ] Sign out returns to login gate
- [ ] Mobile: inbox fills screen; tapping conversation shows thread; back button returns to inbox

---

## End-to-End (Docker)

- [ ] `bash scripts/start_mac.sh` builds and runs container at localhost:8000
- [ ] Visitor chat loads at `http://localhost:8000`
- [ ] Admin loads at `http://localhost:8000/admin`
- [ ] Full diet planning conversation with the AI works end to end
- [ ] Q1 instant answer works
- [ ] Admin can post and visitor sees the human bubble
- [ ] `bash scripts/stop_mac.sh` stops the container cleanly
