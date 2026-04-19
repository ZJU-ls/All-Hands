# Track D — I-0015 + I-0016 · Chat UX Native · DONE

> Branch: `fix-chat-ux` (cut from main `43806ff`)
> Dispatch spec: `START-HERE.md`
> Scope: two P0 product-quality issues from the 2026-04-19 user product review —
> Composer ergonomics (I-0015) and universal streaming output (I-0016).

---

## 1. Commits landed (ordered)

| SHA | Subject |
|---|---|
| `aae5a6b` | `[fix-i0015-i0016] feat(chat): unified stream-client + Composer + streaming MessageBubble` |
| `3e2b7c3` | `[fix-i0015-i0016] fix(chat-api): abort agent stream when client disconnects` |
| `2a83152` | `[fix-i0015-i0016] refactor(chat-consumers): migrate InputBar + ModelTestDialog to Composer + stream-client` |
| *(this commit)* | `[fix-i0015-i0016] test(chat-ux): playwright e2e + audit doc + close I-0015/I-0016` |

All four prefixed with `[fix-i0015-i0016]`; every commit passes `./scripts/check.sh`; no `--no-verify`, no hook skips.

---

## 2. Files touched

### New

- `web/lib/stream-client.ts` — unified SSE consumer (`openStream`, `parseSseFrame`, `StreamHandle`).
- `web/components/chat/Composer.tsx` — AI-native input (send/stop one button; ControlBar slot; ThinkingToggle).
- `web/components/chat/__tests__/Composer.test.tsx` — send/stop toggle, Enter-during-streaming → abort, disabled state, ThinkingToggle.
- `web/components/chat/__tests__/MessageBubble.test.tsx` — streaming cursor rules (partial content, pre-first-token, post-stream, user messages).
- `web/lib/__tests__/stream-client.test.ts` — SSE parser + abort + reasoning routing + HTTP error surface.
- `web/tests/e2e/chat-ux.spec.ts` — playwright e2e: send → stop glyph → typewriter grows → abort → resend.
- `backend/tests/integration/test_chat_cancel.py` — proves `aclose()` fires on disconnect.
- `docs/chat-ux-audit.md` — enumerates every agent-output surface with migration verdict.

### Modified

- `web/components/chat/InputBar.tsx` — thin Composer wrapper; drives stream-client; `streamRef.current?.abort()` on stop.
- `web/components/chat/MessageBubble.tsx` — extracted `StreamingCursor` subcomponent; shows `▍` whenever assistant streams.
- `web/components/gateway/ModelTestDialog.tsx` — dropped bespoke SSE; ThinkingToggle moved from "高级参数" into ControlBar.
- `web/lib/api.ts` — removed the now-dead `sendMessage` / `buildSSEUrl` (stream-client is the single path).
- `backend/src/allhands/api/routers/chat.py` — disconnect polling + generator `aclose()` in `finally`.
- `docs/issues/INDEX.md` — removed I-0015/I-0016 rows · P0 5 → 3 · open 14 → 12 · history line.

### Moved (open → closed)

- `docs/issues/closed/I-0015-composer-ergonomics-ai-native.md` (status flipped; 关闭记录 appended).
- `docs/issues/closed/I-0016-streaming-output-universal.md` (status flipped; 关闭记录 appended).

---

## 3. Audit

Full enumeration of agent-output consumers at `docs/chat-ux-audit.md`. Two surfaces needed migration:

1. **Main chat** (`/chat/[conversationId]`) — used bespoke `api.ts::sendMessage` SSE; no stop button; cursor hidden during streaming. Now: Composer + stream-client + always-on cursor while streaming.
2. **ModelTestDialog** (`/gateway`) — had a separate "中止" button (violating I-0015 "same button") and hid ThinkingToggle inside "高级参数" (violating "below the input"). Now: Composer with unified send/stop + ControlBar ThinkingToggle.

All other surfaces (tasks Q&A panels, cockpit log, Gateway/Skills/MCP/Employees/Triggers/Channels/Market pages, design-lab, settings) are CRUD or read-only — no agent text output to stream. Rationale in audit §2.

---

## 4. Validation

### `./scripts/check.sh` — **GREEN**

- backend: `ruff check` · `ruff format --check` · `mypy` (141 files) · `lint-imports` (3/3 contracts kept) · `pytest` (695 passed, 1 skipped, 15 xfailed unrelated to Track D)
- web: `eslint` (0 warn) · `tsc --noEmit` (0 error) · `vitest` (524 passed, 41 skipped)
- acceptance: `self-review.sh` green (INDEX P0=3 / P1=4 / P2=5 / open=12) · `walkthrough-acceptance.sh` green · L01 Tool-First symmetry green

### Core regression coverage

| Test | What it proves |
|---|---|
| `stream-client.test.ts` | SSE parsing (multi-line data, comments), abort doesn't surface as onError, external AbortSignal honored, HTTP 500 → onError |
| `Composer.test.tsx` | Send glyph when idle; stop glyph while streaming; Enter during streaming → onAbort; Shift+Enter stays a newline |
| `MessageBubble.test.tsx` | Cursor visible during streaming (even empty content); hidden post-stream; never on user bubbles |
| `test_chat_cancel.py` | Backend generator `aclose()`s on client disconnect — agent loop actually stops |
| `chat-ux.spec.ts` (playwright) | Full flow: send → stop glyph → assistant text length strictly grows → abort → new send opens a new stream |

---

## 5. Visual-discipline compliance (re-verified)

- No icon libs; send uses the already-registered `ArrowRightIcon` (1-line SVG, 1.5px stroke); stop is a filled `<div class="bg-current">` primitive — no new SVG asset introduced.
- All colors via tokens (`bg-primary`, `text-text-muted`, `border-border`, …). Zero hex / `bg-zinc-*` / `dark:` parallels added. Lint rule `ux-principles.test.ts::P03/P08` enforces.
- Motion: `transition-colors duration-fast` (token) — no `duration-150`, no `transition-all`, no `hover:scale`, no Framer/GSAP.
- Cursor animation: CSS keyframe `ah-caret` in `app/globals.css` (1s step-end blink). No JS animation.

---

## 6. Known follow-ups (out of scope for Track D, filed as their own issues)

- `I-0005` artifact_changed SSE (P0, open) — orthogonal, not touched.
- `I-0006` cockpit polling vs SSE (P0, open) — orthogonal.
- `I-0007` shared state components (P0, open) — orthogonal.

None of the above block I-0015/I-0016 DoD.

---

*Handoff ready — merge to `main` on Track-D-reviewer approval.*
