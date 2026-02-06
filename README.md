# Chatty
Made with Vue 3 + Vite. The web app connects to a [self-hosted AI memory server](https://github.com/weixian95/brain-at-home) (a memory-enabled Ollama gateway).
Its main goal is to provide a simple setup for interacting with various self-hosted AI models over a private network.

## Features
- Model picker (loads from `/api/tags` with `/api/models` fallback)
- Server‑backed conversation list (`/api/chats?user_id=...`)
- Load full message history per chat (`/api/chats/:chat_id/messages`)
- Delete chat (`DELETE /api/chats/:chat_id`)
- Markdown rendering with sanitization

## Requirements
- Self‑hosted AI memory server API running and reachable from your private network (setup: see [here](https://github.com/weixian95/brain-at-home).)

## Configure API
Set `VITE_API_BASE` in `.env.local`.

```bash
VITE_API_BASE=http://your-tailnet-host:3000
```
Replace the URL with your own private host.

Chatty stores a stable `user_id` in `localStorage` so the server can associate chats with the same user across sessions. Chat history is **not** stored locally.

## Development

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
pnpm preview
```
