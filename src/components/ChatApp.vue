<template>
  <div class="chat">
    <ChatHistoryPanel
      ref="historyRef"
      :current-chat-id="currentChatId"
      :busy="busy"
      :api-base="API_BASE"
      :user-id="userId"
      @clear="handleClearActiveChat"
      @open="handleOpenConversation"
    />
    <div class="chat-view">
      <header>
        <div class="brand">Chatty</div>
        <div class="server-status" :data-state="serverStatus" aria-live="polite">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-label">{{ serverName }}</span>
          <span class="status-text">{{ serverStatusLabel }}</span>
        </div>
      </header>
      <div class="log-container">
        <Log ref="logRef" :messages="messages" :stream-info="streamInfo" />
      </div>
      <div class="prompt-input">
        <ModelSelector
          v-model="selectedModel"
          :models="models"
          :loading="loadingModels"
          :busy="busy"
          @refresh="loadModels"
        />
        <form class="prompt" @submit.prevent="handleSubmit">
          <PromptInput v-model="prompt" :disabled="busy" @submit="handleSubmit" />
          <button class="primary" type="submit" :disabled="busy">Send</button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import Log from './Log.vue'
import ChatHistoryPanel from './ChatHistoryPanel.vue'
import PromptInput from './PromptInput.vue'
import ModelSelector from './ModelSelector/ModelSelector.vue'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:3000'
const SERVER_NAME = (import.meta.env.VITE_SERVER_NAME as string | undefined) || 'Server'
const ENDPOINTS = {
  tags: `${API_BASE}/api/tags`,
  models: `${API_BASE}/api/models`,
  chat: `${API_BASE}/api/chat`,
  health: `${API_BASE}/health`,
}
const USER_STORAGE_KEY = 'chatty-user-id-v1'
const MODEL_STORAGE_KEY = 'chatty-selected-model-v1'

const md = new MarkdownIt({
  linkify: true,
  breaks: true,
})

type Message = {
  id: string
  role: 'user' | 'bot'
  raw: string
  html: string
  ts: number | null
  pending?: boolean
}

type StoredMessage = {
  id: string
  role: 'user' | 'bot'
  raw: string
  ts?: number | null
}

type HistoryPanelExpose = {
  refreshList: () => void
}

const models = ref<string[]>([])
const selectedModel = ref('')
const loadingModels = ref(false)
const prompt = ref('')
const busy = ref(false)
const userId = ref(loadUserId())
const currentChatId = ref(createScopedId('chat'))

const historyRef = ref<HistoryPanelExpose | null>(null)
const logRef = ref<InstanceType<typeof Log> | null>(null)
const messages = ref<Message[]>([])
const historyRefreshTimer = ref<number | null>(null)
const streamInfo = ref('')
const DEFAULT_STREAM_INFO = 'Contacting model...'
const STREAMING_INFO = 'Generating response...'
const serverStatus = ref<'pending' | 'online' | 'offline'>('pending')
const serverName = ref(SERVER_NAME)
const serverStatusLabel = computed(() => {
  switch (serverStatus.value) {
    case 'online':
      return 'online'
    case 'offline':
      return 'offline'
    default:
      return 'checking'
  }
})
const HEALTH_BASE_DELAY = 2000
const HEALTH_MAX_DELAY = 30000
const HEALTH_SUCCESS_INTERVAL = 15000
const MAX_HEALTH_ATTEMPTS = 3
let serverStatusTimer: number | null = null
let serverStatusAttempts = 0

const canSend = computed(() => !busy.value && prompt.value.trim().length > 0)

function createScopedId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function loadUserId() {
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // Ignore storage errors.
  }
  const created = createScopedId('user')
  try {
    localStorage.setItem(USER_STORAGE_KEY, created)
  } catch {
    // Ignore storage errors.
  }
  return created
}

function resetChatId() {
  currentChatId.value = createScopedId('chat')
}

function scheduleHistoryRefresh() {
  historyRef.value?.refreshList()
  if (historyRefreshTimer.value !== null) {
    window.clearTimeout(historyRefreshTimer.value)
  }
  historyRefreshTimer.value = window.setTimeout(() => {
    historyRef.value?.refreshList()
  }, 800)
}

function handleClearActiveChat() {
  if (busy.value) return
  messages.value = []
  prompt.value = ''
  resetChatId()
}

function handleOpenConversation(payload: { chatId: string; messages: StoredMessage[] }) {
  messages.value = hydrateMessages(payload.messages)
  currentChatId.value = payload.chatId
  prompt.value = ''
  nextTick(scrollToBottom)
}

function sanitizeMarkdown(text: string) {
  const rendered = md.render(text)
  return DOMPurify.sanitize(rendered)
}

function scrollToBottom() {
  logRef.value?.scrollToBottom()
}

function addMessage(role: Message['role'], text: string, ts?: number | null) {
  const message = reactive<Message>({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    raw: text,
    html: sanitizeMarkdown(text),
    ts: ts ?? Date.now(),
    pending: false,
  })
  messages.value.push(message)
  nextTick(scrollToBottom)
  return message
}

function hydrateMessages(source: StoredMessage[]) {
  return source.map((message) => ({
    id: message.id,
    role: message.role,
    raw: message.raw,
    html: sanitizeMarkdown(message.raw),
    ts: typeof message.ts === 'number' ? message.ts : null,
  }))
}

type StreamEvent = {
  stage?: string
  content?: string
  query?: string
  freshness?: string
  items?: Array<{ title?: string; source?: string }>
  count?: number
  with_content?: number
  error?: string
  done?: boolean
}

function normalizeStreamText(value?: string, limit = 160) {
  if (!value) return ''
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, Math.max(0, limit - 3))}...`
}

function formatFreshness(value?: string) {
  switch (value) {
    case 'pd':
      return 'past day'
    case 'pw':
      return 'past week'
    case 'pm':
      return 'past month'
    case 'py':
      return 'past year'
    default:
      return ''
  }
}

function formatStreamInfo(event: StreamEvent) {
  const stage = event.stage
  if (!stage) return ''
  switch (stage) {
    case 'digest_prompt': {
      const content = normalizeStreamText(event.content, 120)
      return content ? `Digest: ${content}` : 'Digesting prompt...'
    }
    case 'search_started': {
      const query = normalizeStreamText(event.query, 120)
      const freshness = formatFreshness(event.freshness)
      if (query && freshness) return `Searching (${freshness}): ${query}`
      if (query) return `Searching: ${query}`
      return 'Searching the web...'
    }
    case 'search_summary': {
      const items = Array.isArray(event.items) ? event.items : []
      if (!items.length) return 'Search complete. No sources found.'
      const summary = items
        .slice(0, 3)
        .map((item) => {
          const title = normalizeStreamText(item.title, 80) || 'Untitled'
          return item.source ? `${title} (${item.source})` : title
        })
        .join(' | ')
      return `Sources: ${summary}`
    }
    case 'fetch_started':
      return typeof event.count === 'number'
        ? `Fetching ${event.count} sources...`
        : 'Fetching sources...'
    case 'fetch_complete':
      if (typeof event.count === 'number' && typeof event.with_content === 'number') {
        return `Fetched ${event.with_content}/${event.count} sources.`
      }
      if (typeof event.count === 'number') return `Fetched ${event.count} sources.`
      return 'Sources fetched.'
    case 'analysis': {
      const content = normalizeStreamText(event.content, 140)
      return content || 'Analyzing sources...'
    }
    case 'final_answer':
      return ''
    case 'error': {
      const content = normalizeStreamText(event.error, 160)
      return content ? `Web agent error: ${content}` : 'Web agent error.'
    }
    default:
      return 'Working...'
  }
}

function clearServerHealthTimer() {
  if (serverStatusTimer !== null) {
    window.clearTimeout(serverStatusTimer)
    serverStatusTimer = null
  }
}

function scheduleServerHealthCheck(delayMs: number) {
  clearServerHealthTimer()
  serverStatusTimer = window.setTimeout(() => {
    void runServerHealthCheck()
  }, delayMs)
}

async function runServerHealthCheck() {
  try {
    const res = await fetch(ENDPOINTS.health, { cache: 'no-store' })
    if (!res.ok) {
      throw new Error('Health check failed.')
    }
    serverStatus.value = 'online'
    serverStatusAttempts = 0
    scheduleServerHealthCheck(HEALTH_SUCCESS_INTERVAL)
  } catch {
    serverStatusAttempts += 1
    if (serverStatusAttempts >= MAX_HEALTH_ATTEMPTS) {
      serverStatus.value = 'offline'
      scheduleServerHealthCheck(HEALTH_MAX_DELAY)
      return
    }
    serverStatus.value = 'pending'
    const backoff = Math.min(
      HEALTH_BASE_DELAY * 2 ** Math.max(0, serverStatusAttempts - 1),
      HEALTH_MAX_DELAY,
    )
    scheduleServerHealthCheck(backoff)
  }
}

function startServerHealthPolling() {
  serverStatus.value = 'pending'
  serverStatusAttempts = 0
  clearServerHealthTimer()
  void runServerHealthCheck()
}

function loadModelPreference() {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY)
    if (stored) {
      selectedModel.value = stored
    }
  } catch {
    // Ignore storage errors.
  }
}

function persistModelPreference() {
  try {
    if (selectedModel.value) {
      localStorage.setItem(MODEL_STORAGE_KEY, selectedModel.value)
    } else {
      localStorage.removeItem(MODEL_STORAGE_KEY)
    }
  } catch {
    // Ignore storage errors.
  }
}

watch(
  () => selectedModel.value,
  () => {
    persistModelPreference()
  },
)

async function loadModels() {
  loadingModels.value = true
  try {
    let res = await fetch(ENDPOINTS.tags)
    if (res.status === 404) {
      res = await fetch(ENDPOINTS.models)
    }
    if (!res.ok) throw new Error(`Model fetch failed: ${res.status}`)
    const data = await res.json()
    models.value = (data.models || []).map((model: { name: string }) => model.name)
    if (!models.value.includes(selectedModel.value)) {
      selectedModel.value = models.value[0] || ''
    }
  } catch (err) {
    models.value = []
    addMessage('bot', `Model list error: ${(err as Error).message}`)
  } finally {
    loadingModels.value = false
  }
}

async function streamCompletion(model: string, text: string) {
  streamInfo.value = DEFAULT_STREAM_INFO
  const payload = {
    user_id: userId.value,
    chat_id: currentChatId.value,
    model_id: model,
    prompt: text,
    message_id: createScopedId('message'),
    client_ts: Date.now(),
    stream: true,
  }

  const res = await fetch(ENDPOINTS.chat, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const message = addMessage('bot', '', Date.now())
  message.raw = ''
  message.html = ''
  message.pending = true

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const chunk = JSON.parse(line) as StreamEvent & {
            message?: { content?: string }
            response?: string
          }
          if (chunk && typeof chunk.stage === 'string') {
            const info = formatStreamInfo(chunk)
            if (info) {
              streamInfo.value = info
            }
            if (chunk.stage === 'final_answer' && typeof chunk.content === 'string') {
              streamInfo.value = ''
              message.pending = false
              message.raw = chunk.content
              message.html = sanitizeMarkdown(message.raw)
              await nextTick()
              scrollToBottom()
            }
            if (chunk.stage === 'error') {
              const errorText = typeof chunk.error === 'string' ? chunk.error : 'Web agent error.'
              message.pending = false
              message.raw = `Error: ${errorText}`
              message.html = sanitizeMarkdown(message.raw)
              await nextTick()
              scrollToBottom()
            }
            if (chunk.done) {
              message.pending = false
              return
            }
            continue
          }

          const content =
            typeof chunk?.message?.content === 'string'
              ? chunk.message.content
              : typeof chunk?.response === 'string'
                ? chunk.response
                : ''
          if (content) {
            if (!streamInfo.value || streamInfo.value === DEFAULT_STREAM_INFO) {
              streamInfo.value = STREAMING_INFO
            }
            message.pending = false
            message.raw += content
            message.html = sanitizeMarkdown(message.raw)
            await nextTick()
            scrollToBottom()
          }
          if (chunk?.done) {
            message.pending = false
            return
          }
        } catch {
          message.raw += '\n[Stream parse error]'
          message.html = sanitizeMarkdown(message.raw)
        }
      }
    }
  } finally {
    message.pending = false
  }
}

async function handleSubmit() {
  if (!canSend.value) return
  if (!selectedModel.value) {
    addMessage('bot', 'Select a model first.')
    return
  }

  const text = prompt.value.trim()
  prompt.value = ''
  addMessage('user', text, Date.now())

  busy.value = true
  try {
    await streamCompletion(selectedModel.value, text)
    scheduleHistoryRefresh()
  } catch (err) {
    addMessage('bot', `Error: ${(err as Error).message}`)
  } finally {
    busy.value = false
    streamInfo.value = ''
  }
}

onMounted(loadModelPreference)
onMounted(loadModels)
onMounted(startServerHealthPolling)
onBeforeUnmount(() => {
  clearServerHealthTimer()
})
</script>

<style lang="scss">
.chat {
  position: fixed;
  width: 100%;
  height: 100%;
  display: flex;

  .chat-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    background-color: #0b1018;

    header {
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 24px;
      color: #e7edf7;
      font-weight: 600;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      flex-shrink: 0;
    }

    .brand {
      font-size: 1.05rem;
      letter-spacing: 0.02em;
    }

    .server-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      color: rgba(231, 237, 247, 0.78);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 6px 10px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #94a3b8;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.15);
    }

    .server-status[data-state='online'] .status-dot {
      background: #22c55e;
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
    }

    .server-status[data-state='pending'] .status-dot {
      background: #facc15;
      box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.2);
    }

    .server-status[data-state='offline'] .status-dot {
      background: #ef4444;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
    }

    .status-label {
      letter-spacing: 0.02em;
    }

    .status-text {
      text-transform: uppercase;
      font-size: 0.68rem;
      letter-spacing: 0.08em;
      color: rgba(231, 237, 247, 0.6);
    }
  }

  .log-container {
    flex: 1;
    overflow: hidden;
    position: relative;
    background: linear-gradient(180deg, rgba(16, 22, 32, 0.7), rgba(10, 14, 22, 0.85));
  }

  .prompt-input {
    position: sticky;
    bottom: 0;
    padding: 16px 24px;
    background: rgba(14, 20, 30, 0.95);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .prompt {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
  }

  .primary {
    background: linear-gradient(180deg, #6fc3ff, #4fa7ff);
    color: #0b1320;
    border: none;
    padding: 12px 20px;
    font-weight: 600;
    border-radius: 12px;
    cursor: pointer;
  }

  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}
</style>
