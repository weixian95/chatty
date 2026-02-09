# Chatty
Chatty is a Vue 3 + Vite UI for a self-hosted AI model server on a private network set up with Tailscale. It’s intended to test a self-hosted AI model while away from the server by connecting over Tailscale.

## Demo
This project is published at [my github page](https://weixian95.github.io/tools/chatty/). Access to the backend
is restricted to the private Tailnet; visitors outside the Tailnet can load the UI but will see the server as
offline.

## How It Connects
- The server lives on your private Tailscale network.
- Models are hosted locally on that private server.

## Panels and Behavior
**History Panel**
- Titles are generated server-side and pushed via SSE when available.
- The timestamp shows the latest activity for the chat (typically the latest user prompt, then updated
  if a post-answer task modifies metadata).
- The panel is locked only while this client is sending a prompt.

**Log Panel**
- User prompt → `/api/chat` stream → routing + sources → answer tokens.
- Web search on: the server generates a Brave query, fetches sources, then answers with citations.
- Web search off: answers are generated locally.
- Optional post-answer polish can update the final answer and is pushed via SSE.

**Model Selector**
- Loads models from `/api/tags` with `/api/models` fallback.
- The selection is synchronized per chat across devices.

**Web Search Toggle**
- Per-chat toggle synced across devices.
- Sends `use_web` with requests and `/api/chats/:chat_id/state` updates.

**Prompt Textbox**
- Disabled while the current chat is busy (local or remote submit).
- Cancel button appears only for local sends.

## Realtime Sync (SSE)
- Global stream: `GET /api/stream` for chat list + shared UI state.
- Per-chat stream: `GET /api/chats/:chat_id/stream` for title/topic/answer + chat state updates.

## Configure API
Set `VITE_API_BASE` in `.env.local`.

```bash
VITE_API_BASE=http://your-tailnet-host:3000
```

Chatty stores model + web toggle preferences locally, and chat history is stored on the server.
