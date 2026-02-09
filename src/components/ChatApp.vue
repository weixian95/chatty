<template>
  <div class="chat">
    <ChatHistoryPanel
      ref="historyRef"
      :current-chat-id="currentChatId"
      :busy="historyLocked"
      :api-base="API_BASE"
      :is-mobile="isMobileWidth"
      @clear="handleClearActiveChat"
      @open="handleOpenConversation"
    />
    <div class="chat-view">
      <header>
        <div class="header-left">
          <div class="brand">Chatty</div>
        </div>
        <div class="header-right">
          <div class="server-status" :data-state="serverStatus" aria-live="polite">
            <span class="status-dot" aria-hidden="true"></span>
            <span v-if="serverStatusAlert" class="status-alert">{{ serverStatusAlert }}</span>
            <span v-else class="status-label">{{ serverName }}</span>
            <span v-if="!serverStatusAlert" class="status-text">{{ serverStatusLabel }}</span>
          </div>
        </div>
      </header>
      <div v-if="currentTopic" class="topic-bar" title="Latest discussion">
        <span class="topic-label">Latest discussion:</span>
        <span class="topic-text">{{ currentTopic }}</span>
      </div>
      <div class="log-container">
        <Log ref="logRef" :messages="messages" :stream-info="streamInfo" />
      </div>
      <div class="prompt-input">
        <div class="prompt-controls">
          <ModelSelector
            v-model="selectedModel"
            :models="models"
            :loading="loadingModels"
            :busy="busy"
          />
          <button
            class="web-toggle"
            type="button"
            :aria-pressed="useWebSearch"
            aria-label="Toggle web search"
            :disabled="busy"
            @click="toggleWebSearch"
          >
            <span class="web-toggle-track" aria-hidden="true">
              <span class="web-toggle-knob"></span>
            </span>
            <span class="web-toggle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M3.8 12h16.4" />
                <path d="M12 3.5c3 3.2 3 13.8 0 17" />
                <path d="M12 3.5c-3 3.2-3 13.8 0 17" />
              </svg>
            </span>
            <span class="web-toggle-label">Web search</span>
          </button>
        </div>
        <form class="prompt" @submit.prevent="handleSubmit">
          <div class="prompt-field">
            <PromptInput v-model="prompt" :disabled="busy" @submit="handleSubmit" />
            <button
              v-if="localBusy"
              class="primary send-inside cancel-inside"
              type="button"
              :disabled="!localBusy"
              @click="cancelActiveRequest"
              aria-label="Cancel"
            >
              <span class="cancel-square" aria-hidden="true"></span>
            </button>
            <button v-else class="primary send-inside" type="submit" :disabled="busy">Send</button>
          </div>
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
const SERVER_NAME = 'Brain at home'
const ENDPOINTS = {
  tags: `${API_BASE}/api/tags`,
  models: `${API_BASE}/api/models`,
  chat: `${API_BASE}/api/chat`,
  health: `${API_BASE}/health`,
}
const MODEL_STORAGE_KEY = 'chatty-selected-model-v1'
const WEB_SEARCH_STORAGE_KEY = 'chatty-web-search-v1'

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
  citations?: Array<{ url: string; title?: string }>
  polished?: boolean
  remotePending?: boolean
}

type StoredMessage = {
  id: string
  role: 'user' | 'bot'
  raw: string
  ts?: number | null
  polished?: boolean
}

type ChatSummary = {
  chat_id?: string
  title?: string
  chat_title?: string
  summary?: string
  topic?: string
  last_updated_ts?: number
  last_message_ts?: number
  last_summary_ts?: number
  last_topic_ts?: number
  raw_count?: number
}

type ChatListUpdate = {
  type?: 'added' | 'updated' | 'deleted'
  chat?: ChatSummary
  chat_id?: string
}

type ChatUiState = {
  chat_id?: string
  use_web?: boolean | null
  model_id?: string
  busy?: boolean
  input_disabled?: boolean
  history_locked?: boolean
  active?: boolean
  last_message_id?: string
  last_update_ts?: number
}

type GlobalUiState = {
  active_chat_id?: string
  busy?: boolean
  busy_chats?: string[]
  input_disabled?: boolean
  history_locked?: boolean
}

type UiStateSnapshot = {
  global?: GlobalUiState
  chats?: ChatUiState[]
}

type HistoryPanelExpose = {
  refreshList: () => void
  applyChatInfoUpdate: (update: ChatInfoUpdate) => void
  applyChatListSnapshot: (chats: ChatSummary[]) => void
  applyChatListUpdate: (update: ChatListUpdate) => void
}

const models = ref<string[]>([])
const selectedModel = ref('')
const loadingModels = ref(false)
const prompt = ref('')
const localBusy = ref(false)
const currentChatId = ref(createScopedId('chat'))
const useWebSearch = ref(false)
const defaultWebSearch = ref(false)
const globalUiState = reactive<GlobalUiState>({
  active_chat_id: '',
  busy: false,
  busy_chats: [],
  input_disabled: false,
  history_locked: false,
})
const chatUiState = reactive<Record<string, ChatUiState>>({})

const historyRef = ref<HistoryPanelExpose | null>(null)
const logRef = ref<InstanceType<typeof Log> | null>(null)
const messages = ref<Message[]>([])
const activeAbort = ref<AbortController | null>(null)
const activeMessageId = ref<string | null>(null)
const remotePendingId = ref<string | null>(null)
const remotePendingCleanupTimer = ref<number | null>(null)
const historyRefreshTimer = ref<number | null>(null)
const streamInfo = ref('')
const currentTopic = ref('')
const currentTopicTs = ref<number | null>(null)
const currentChatLastMessageTs = ref<number | null>(null)
const metaRefreshTimer = ref<number | null>(null)
const metaRefreshAttempts = ref(0)
const chatInfoSource = ref<EventSource | null>(null)
const chatInfoReconnectTimer = ref<number | null>(null)
const chatInfoRetryMs = ref(1000)
const CHAT_INFO_RETRY_MAX = 30000
const globalStreamSource = ref<EventSource | null>(null)
const globalStreamReconnectTimer = ref<number | null>(null)
const globalStreamRetryMs = ref(1000)
const GLOBAL_STREAM_RETRY_MAX = 30000
const STRATEGY_STREAM_INFO = 'Deciding information sources...'
const DEFAULT_STREAM_INFO = 'Contacting model...'
const STREAMING_INFO = 'Generating response...'
const META_REFRESH_BASE_DELAY = 1200
const META_REFRESH_MAX_ATTEMPTS = 6
const MOBILE_BREAKPOINT = 774
const serverStatus = ref<'pending' | 'online' | 'offline'>('pending')
const serverName = ref(SERVER_NAME)
const isMobileWidth = ref(
  typeof window !== 'undefined'
    ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
    : false,
)
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
const serverStatusAlert = computed(() => {
  if (serverStatus.value !== 'offline') return ''
  return 'Server offline or not on Tailnet.'
})
const historyLocked = computed(() => Boolean(globalUiState.history_locked))
const currentChatState = computed(() => chatUiState[currentChatId.value])
const remoteChatBusy = computed(() => {
  const state = currentChatState.value
  if (!state) return false
  if (typeof state.input_disabled === 'boolean') return state.input_disabled
  return Boolean(state.busy)
})
const busy = computed(() => localBusy.value || remoteChatBusy.value)
const HEALTH_BASE_DELAY = 2000
const HEALTH_MAX_DELAY = 30000
const HEALTH_SUCCESS_INTERVAL = 15000
const HEALTH_OFFLINE_INTERVAL = 5000
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

function clearMetaRefresh() {
  if (metaRefreshTimer.value !== null) {
    window.clearTimeout(metaRefreshTimer.value)
    metaRefreshTimer.value = null
  }
  metaRefreshAttempts.value = 0
}

function buildChatMetaUrl(chatId: string) {
  return `${API_BASE}/api/chats/${encodeURIComponent(chatId)}`
}

function buildChatInfoStreamUrl(chatId: string) {
  return `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/stream`
}

function buildGlobalStreamUrl() {
  return `${API_BASE}/api/stream`
}

function buildChatStateUrl(chatId: string) {
  return `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/state`
}

function closeChatInfoStream() {
  if (chatInfoReconnectTimer.value !== null) {
    window.clearTimeout(chatInfoReconnectTimer.value)
    chatInfoReconnectTimer.value = null
  }
  chatInfoRetryMs.value = 1000
  if (chatInfoSource.value) {
    chatInfoSource.value.close()
    chatInfoSource.value = null
  }
}

function closeGlobalStream() {
  if (globalStreamReconnectTimer.value !== null) {
    window.clearTimeout(globalStreamReconnectTimer.value)
    globalStreamReconnectTimer.value = null
  }
  globalStreamRetryMs.value = 1000
  if (globalStreamSource.value) {
    globalStreamSource.value.close()
    globalStreamSource.value = null
  }
}

function applyGlobalStateSnapshot(payload?: GlobalUiState) {
  if (!payload) return
  if (typeof payload.active_chat_id === 'string') {
    globalUiState.active_chat_id = payload.active_chat_id
  }
  if (typeof payload.busy === 'boolean') {
    globalUiState.busy = payload.busy
  }
  if (Array.isArray(payload.busy_chats)) {
    globalUiState.busy_chats = payload.busy_chats.filter((id) => typeof id === 'string')
  }
  if (typeof payload.input_disabled === 'boolean') {
    globalUiState.input_disabled = payload.input_disabled
  }
  if (typeof payload.history_locked === 'boolean') {
    globalUiState.history_locked = payload.history_locked
  }
}

function applyChatStateSnapshot(chatId: string, payload?: ChatUiState) {
  if (!chatId || !payload) return
  const existing = chatUiState[chatId] || { chat_id: chatId }
  const updated: ChatUiState = { ...existing, chat_id: chatId }

  if (typeof payload.use_web === 'boolean') {
    updated.use_web = payload.use_web
  }
  if (typeof payload.model_id === 'string') {
    updated.model_id = payload.model_id
  }
  if (typeof payload.busy === 'boolean') {
    updated.busy = payload.busy
    if (typeof updated.input_disabled !== 'boolean') {
      updated.input_disabled = payload.busy
    }
  }
  if (typeof payload.input_disabled === 'boolean') {
    updated.input_disabled = payload.input_disabled
  }
  if (typeof payload.history_locked === 'boolean') {
    updated.history_locked = payload.history_locked
  }
  if (typeof payload.active === 'boolean') {
    updated.active = payload.active
  }
  if (typeof payload.last_message_id === 'string') {
    updated.last_message_id = payload.last_message_id
  }
  if (typeof payload.last_update_ts === 'number') {
    updated.last_update_ts = payload.last_update_ts
  }

  chatUiState[chatId] = updated

  if (chatId === currentChatId.value && typeof updated.use_web === 'boolean') {
    useWebSearch.value = updated.use_web
  }
  if (chatId === currentChatId.value && typeof updated.model_id === 'string' && updated.model_id) {
    selectedModel.value = updated.model_id
  }
}

function applyUiStateSnapshot(snapshot?: UiStateSnapshot) {
  if (!snapshot) return
  if (snapshot.global) {
    applyGlobalStateSnapshot(snapshot.global)
  }
  if (Array.isArray(snapshot.chats)) {
    snapshot.chats.forEach((state) => {
      if (state && typeof state.chat_id === 'string') {
        applyChatStateSnapshot(state.chat_id, state)
      }
    })
  }
}

function handleChatListSnapshot(chats?: ChatSummary[]) {
  if (!Array.isArray(chats)) return
  historyRef.value?.applyChatListSnapshot(chats)
}

function handleChatListUpdate(update?: ChatListUpdate) {
  if (!update) return
  historyRef.value?.applyChatListUpdate(update)
  if (update.type === 'deleted' && update.chat_id === currentChatId.value) {
    handleClearActiveChat({ force: true })
  }
}

function scheduleGlobalStreamReconnect() {
  if (globalStreamReconnectTimer.value !== null) return
  const delay = globalStreamRetryMs.value
  globalStreamReconnectTimer.value = window.setTimeout(() => {
    globalStreamReconnectTimer.value = null
    openGlobalStream(true)
  }, delay)
  globalStreamRetryMs.value = Math.min(
    globalStreamRetryMs.value * 2,
    GLOBAL_STREAM_RETRY_MAX,
  )
}

function openGlobalStream(isRetry = false) {
  if (!API_BASE) return
  if (!isRetry) {
    closeGlobalStream()
  }
  try {
    const source = new EventSource(buildGlobalStreamUrl())
    source.addEventListener('chatlist', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { chats?: ChatSummary[] }
        handleChatListSnapshot(payload.chats)
      } catch {
        // ignore
      }
    })
    source.addEventListener('chatlistupdate', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as ChatListUpdate
        handleChatListUpdate(payload)
      } catch {
        // ignore
      }
    })
    source.addEventListener('uistate', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as UiStateSnapshot
        applyUiStateSnapshot(payload)
      } catch {
        // ignore
      }
    })
    source.addEventListener('chatstate', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          chat_id?: string
          state?: ChatUiState
        }
        if (payload && typeof payload.chat_id === 'string' && payload.state) {
          applyChatStateSnapshot(payload.chat_id, payload.state)
        }
      } catch {
        // ignore
      }
    })
    source.addEventListener('globalstate', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as GlobalUiState
        applyGlobalStateSnapshot(payload)
      } catch {
        // ignore
      }
    })
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        scheduleGlobalStreamReconnect()
      }
    })
    source.addEventListener('open', () => {
      globalStreamRetryMs.value = 1000
      if (globalStreamReconnectTimer.value !== null) {
        window.clearTimeout(globalStreamReconnectTimer.value)
        globalStreamReconnectTimer.value = null
      }
    })
    globalStreamSource.value = source
  } catch {
    scheduleGlobalStreamReconnect()
  }
}

function handleChatInfoUpdate(update: ChatInfoUpdate) {
  if (!update || typeof update.chat_id !== 'string') return
  if (update.type === 'topic' && update.content?.topic) {
    if (update.chat_id === currentChatId.value) {
      currentTopic.value = update.content.topic
      if (typeof update.content.ts === 'number') {
        currentTopicTs.value = normalizeTimestamp(update.content.ts)
      }
    }
  }
  if (update.type === 'title') {
    historyRef.value?.applyChatInfoUpdate(update)
  }
  if (update.type === 'answer' && update.content?.answer) {
    if (update.chat_id !== currentChatId.value) return
    const lastBot = [...messages.value].reverse().find((item) => item.role === 'bot')
    if (!lastBot) return
    lastBot.raw = update.content.answer
    lastBot.html = sanitizeMarkdown(lastBot.raw)
    lastBot.pending = false
    if (lastBot.remotePending) {
      lastBot.remotePending = false
      remotePendingId.value = null
    }
    if (typeof update.content.polished === 'boolean') {
      lastBot.polished = update.content.polished
    } else {
      lastBot.polished = true
    }
    const extracted = extractCitations(lastBot.raw).map((url) => ({ url }))
    if (extracted.length > 0) {
      lastBot.citations = extracted
    } else if (!lastBot.citations || lastBot.citations.length === 0) {
      lastBot.citations = []
    }
  }
}

function scheduleChatInfoReconnect(chatId: string) {
  if (chatInfoReconnectTimer.value !== null) return
  const delay = chatInfoRetryMs.value
  chatInfoReconnectTimer.value = window.setTimeout(() => {
    chatInfoReconnectTimer.value = null
    openChatInfoStream(chatId, true)
  }, delay)
  chatInfoRetryMs.value = Math.min(chatInfoRetryMs.value * 2, CHAT_INFO_RETRY_MAX)
}

function openChatInfoStream(chatId: string, isRetry = false) {
  if (!chatId || !API_BASE) return
  if (!isRetry) {
    closeChatInfoStream()
  }
  try {
    const source = new EventSource(buildChatInfoStreamUrl(chatId))
    source.addEventListener('chatinfoupdate', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as ChatInfoUpdate
        handleChatInfoUpdate(data)
      } catch {
        // Ignore malformed updates.
      }
    })
    source.addEventListener('chatstate', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          chat_id?: string
          state?: ChatUiState
        }
        if (payload && typeof payload.chat_id === 'string' && payload.state) {
          applyChatStateSnapshot(payload.chat_id, payload.state)
        }
      } catch {
        // Ignore malformed updates.
      }
    })
    source.addEventListener('globalstate', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as GlobalUiState
        applyGlobalStateSnapshot(payload)
      } catch {
        // Ignore malformed updates.
      }
    })
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        scheduleChatInfoReconnect(chatId)
      }
    })
    source.addEventListener('open', () => {
      chatInfoRetryMs.value = 1000
      if (chatInfoReconnectTimer.value !== null) {
        window.clearTimeout(chatInfoReconnectTimer.value)
        chatInfoReconnectTimer.value = null
      }
      if (isRetry) {
        scheduleHistoryRefresh()
        void loadModels()
      }
    })
    chatInfoSource.value = source
  } catch {
    // Ignore EventSource setup errors.
    scheduleChatInfoReconnect(chatId)
  }
}

function shouldPollTopic(lastMessageTs: number | null, lastTopicTs: number | null) {
  if (!lastMessageTs) return false
  if (!lastTopicTs) return true
  return lastTopicTs < lastMessageTs
}

async function fetchChatMeta(chatId: string) {
  if (!chatId) return
  try {
    const res = await fetch(buildChatMetaUrl(chatId), { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    currentTopic.value = typeof data.topic === 'string' ? data.topic : ''
    currentTopicTs.value = normalizeTimestamp(data.last_topic_ts)
    currentChatLastMessageTs.value = normalizeTimestamp(
      data.last_message_ts ?? data.last_updated_ts
    )
    return shouldPollTopic(currentChatLastMessageTs.value, currentTopicTs.value)
  } catch {
    // Ignore errors.
  }
  return false
}

function scheduleMetaRefresh(chatId: string) {
  clearMetaRefresh()
  const poll = async () => {
    if (metaRefreshAttempts.value >= META_REFRESH_MAX_ATTEMPTS) return
    metaRefreshAttempts.value += 1
    const needsMore = await fetchChatMeta(chatId)
    if (!needsMore) return
    if (metaRefreshAttempts.value >= META_REFRESH_MAX_ATTEMPTS) return
    const delay = META_REFRESH_BASE_DELAY * metaRefreshAttempts.value
    metaRefreshTimer.value = window.setTimeout(() => {
      void poll()
    }, delay)
  }
  void poll()
}

function handleClearActiveChat(options: { force?: boolean } = {}) {
  if (!options.force && historyLocked.value) return
  messages.value = []
  prompt.value = ''
  currentTopic.value = ''
  currentTopicTs.value = null
  currentChatLastMessageTs.value = null
  remotePendingId.value = null
  clearRemotePendingTimer()
  clearMetaRefresh()
  resetChatId()
  syncWebSearchForChat(currentChatId.value)
  syncModelForChat(currentChatId.value)
  void updateChatState(currentChatId.value, { active: true })
}

function handleOpenConversation(payload: {
  chatId: string
  messages: StoredMessage[]
}) {
  if (historyLocked.value) return
  messages.value = hydrateMessages(payload.messages)
  currentChatId.value = payload.chatId
  prompt.value = ''
  currentTopic.value = ''
  currentTopicTs.value = null
  currentChatLastMessageTs.value = null
  remotePendingId.value = null
  clearRemotePendingTimer()
  nextTick(scrollToBottom)
  syncWebSearchForChat(payload.chatId)
  syncModelForChat(payload.chatId)
  scheduleMetaRefresh(payload.chatId)
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
    polished: role === 'bot' ? false : undefined,
    citations: role === 'bot' ? extractCitations(text).map((url) => ({ url })) : [],
    remotePending: false,
  })
  messages.value.push(message)
  nextTick(scrollToBottom)
  return message
}

function clearRemotePendingTimer() {
  if (remotePendingCleanupTimer.value !== null) {
    window.clearTimeout(remotePendingCleanupTimer.value)
    remotePendingCleanupTimer.value = null
  }
}

function ensureRemotePendingBubble() {
  if (localBusy.value) return
  const existing = [...messages.value].reverse().find((item) => item.role === 'bot' && item.pending)
  if (existing) return
  const message = addMessage('bot', '', Date.now())
  message.raw = ''
  message.html = ''
  message.pending = true
  message.remotePending = true
  message.citations = []
  remotePendingId.value = message.id
}

function scheduleRemotePendingCleanup() {
  clearRemotePendingTimer()
  if (!remotePendingId.value) return
  remotePendingCleanupTimer.value = window.setTimeout(() => {
    const index = messages.value.findIndex((item) => item.id === remotePendingId.value)
    if (index === -1) {
      remotePendingId.value = null
      return
    }
    const item = messages.value[index]
    if (item.pending && !item.raw) {
      messages.value.splice(index, 1)
    }
    remotePendingId.value = null
  }, 1500)
}

function removeMessage(id: string) {
  const index = messages.value.findIndex((message) => message.id === id)
  if (index === -1) return
  messages.value.splice(index, 1)
}

function hydrateMessages(source: StoredMessage[]) {
  return source.map((message) => ({
    id: message.id,
    role: message.role,
    raw: message.raw,
    html: sanitizeMarkdown(message.raw),
    ts: typeof message.ts === 'number' ? message.ts : null,
    polished: typeof message.polished === 'boolean' ? message.polished : undefined,
    citations: extractCitations(message.raw).map((url) => ({ url })),
  }))
}

type StreamCitation =
  | string
  | {
      url?: string
      link?: string
      source?: string
      title?: string
    }

type StreamEvent = {
  stage?: string
  content?: string
  topic?: string
  ts?: number
  query?: string
  freshness?: string
  items?: Array<{ title?: string; source?: string; url?: string; link?: string }>
  count?: number
  with_content?: number
  error?: string
  route?: string
  decision?: string
  target?: string
  use_web_agent?: boolean
  useWebAgent?: boolean
  sources?: StreamCitation[]
  citations?: StreamCitation[]
  done?: boolean
}

type ChatInfoUpdate = {
  type?: string
  chat_id?: string
  content?: {
    title?: string
    topic?: string
    answer?: string
    polished?: boolean
    ts?: number
  }
}

function normalizeStreamText(value?: string, limit = 160) {
  if (!value) return ''
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, Math.max(0, limit - 3))}...`
}

function normalizeTimestamp(value: unknown) {
  const raw = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(raw) || raw <= 0) return null
  return raw < 1_000_000_000_000 ? raw * 1000 : raw
}

function normalizeUrl(value?: string) {
  if (!value) return ''
  let trimmed = value.trim()
  trimmed = trimmed.replace(/^[<(]+/, '')
  trimmed = trimmed.replace(/[)>.,;:!?]+$/, '')
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
  } catch {
    return ''
  }
  return ''
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getHostname(value?: string) {
  if (!value) return ''
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function extractCitations(text: string) {
  const urls = new Set<string>()
  const matches = text.matchAll(/https?:\/\/\S+/g)
  for (const match of matches) {
    const normalized = normalizeUrl(match[0])
    if (normalized) {
      urls.add(normalized)
    }
  }
  return [...urls]
}

function mergeCitation(
  target: Map<string, string | undefined>,
  urlValue?: string,
  title?: string,
) {
  const normalized = normalizeUrl(urlValue)
  if (!normalized) return
  if (!target.has(normalized) || !target.get(normalized)) {
    target.set(normalized, title)
  }
}

function collectCitationsFromEvent(
  event: StreamEvent,
  target: Map<string, string | undefined>,
) {
  const handleCitation = (item: StreamCitation) => {
    if (typeof item === 'string') {
      mergeCitation(target, item)
      return
    }
    const urlValue = item.url || item.link || item.source
    mergeCitation(target, urlValue, item.title)
  }

  if (Array.isArray(event.citations)) {
    event.citations.forEach(handleCitation)
  }
  if (Array.isArray(event.sources)) {
    event.sources.forEach(handleCitation)
  }
  if (Array.isArray(event.items)) {
    event.items.forEach((item) => {
      mergeCitation(target, item.url || item.link, item.title)
    })
  }
}

function applyCitations(message: Message, collected: Map<string, string | undefined>) {
  extractCitations(message.raw).forEach((url) => mergeCitation(collected, url))
  message.citations = [...collected.entries()].map(([url, title]) => ({ url, title }))

  if (!message.citations.length) return
  let updated = message.raw
  for (const citation of message.citations) {
    if (!citation.title) continue
    const escaped = escapeRegExp(citation.url)
    const pattern = new RegExp(`(^|[^\\]])\\(${escaped}\\)`, 'g')
    updated = updated.replace(pattern, `$1([${citation.title}](${citation.url}))`)
  }
  if (updated !== message.raw) {
    message.raw = updated
    message.html = sanitizeMarkdown(message.raw)
  }
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
    case 'routing': {
      const content = normalizeStreamText(event.content, 120)
      return content ? `Routing: ${content}` : 'Routing request...'
    }
    case 'routing_decision': {
      const explicit =
        typeof event.use_web_agent === 'boolean'
          ? event.use_web_agent
            ? 'web agent'
            : 'local model'
          : typeof event.useWebAgent === 'boolean'
            ? event.useWebAgent
              ? 'web agent'
              : 'local model'
            : ''
      const detail = normalizeStreamText(
        event.content || event.route || event.decision || event.target || explicit,
        120,
      )
      return detail ? `Routing: ${detail}` : 'Routing decision made.'
    }
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
    case 'sources': {
      const sources = Array.isArray(event.sources) ? event.sources : []
      if (!sources.length) return 'Sources ready.'
      const summary = sources
        .slice(0, 3)
        .map((item) => {
          if (typeof item === 'string') {
            return getHostname(item) || normalizeStreamText(item, 80)
          }
          const urlValue = item.url || item.link || item.source || ''
          const title = normalizeStreamText(item.title, 80)
          return title || getHostname(urlValue) || normalizeStreamText(urlValue, 80)
        })
        .filter(Boolean)
        .join(' | ')
      return summary ? `Sources ready: ${summary}` : 'Sources ready.'
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
    case 'topic':
      return ''
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
  const wasOffline = serverStatus.value === 'offline'
  try {
    const res = await fetch(ENDPOINTS.health, { cache: 'no-store' })
    if (!res.ok) {
      throw new Error('Health check failed.')
    }
    serverStatus.value = 'online'
    serverStatusAttempts = 0
    scheduleServerHealthCheck(HEALTH_SUCCESS_INTERVAL)
  } catch {
    if (wasOffline) {
      serverStatus.value = 'offline'
      scheduleServerHealthCheck(HEALTH_OFFLINE_INTERVAL)
      return
    }
    serverStatusAttempts += 1
    if (serverStatusAttempts >= MAX_HEALTH_ATTEMPTS) {
      serverStatus.value = 'offline'
      scheduleServerHealthCheck(HEALTH_OFFLINE_INTERVAL)
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

function startMobileWidthWatcher() {
  if (typeof window === 'undefined') return
  const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  const update = (event: MediaQueryList | MediaQueryListEvent) => {
    isMobileWidth.value = event.matches
  }
  update(mediaQuery)
  if ('addEventListener' in mediaQuery) {
    mediaQuery.addEventListener('change', update)
    onBeforeUnmount(() => {
      mediaQuery.removeEventListener('change', update)
    })
  } else {
    mediaQuery.addListener(update)
    onBeforeUnmount(() => {
      mediaQuery.removeListener(update)
    })
  }
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

function loadWebSearchPreference() {
  try {
    const stored = localStorage.getItem(WEB_SEARCH_STORAGE_KEY)
    if (stored === '1') {
      useWebSearch.value = true
      defaultWebSearch.value = true
      return
    }
    if (stored === '0') {
      useWebSearch.value = false
      defaultWebSearch.value = false
      return
    }
  } catch {
    // Ignore storage errors.
  }
  defaultWebSearch.value = useWebSearch.value
}

function persistWebSearchPreference() {
  try {
    localStorage.setItem(WEB_SEARCH_STORAGE_KEY, useWebSearch.value ? '1' : '0')
  } catch {
    // Ignore storage errors.
  }
}

function syncWebSearchForChat(chatId: string) {
  if (!chatId) return
  const state = chatUiState[chatId]
  if (state && typeof state.use_web === 'boolean') {
    useWebSearch.value = state.use_web
    return
  }
  useWebSearch.value = defaultWebSearch.value
}

function syncModelForChat(chatId: string) {
  if (!chatId) return
  const state = chatUiState[chatId]
  if (state && typeof state.model_id === 'string' && state.model_id) {
    selectedModel.value = state.model_id
    return
  }
  if (selectedModel.value) return
  loadModelPreference()
}

async function updateChatState(
  chatId: string,
  updates: { use_web?: boolean; active?: boolean; model_id?: string },
) {
  if (!chatId || !API_BASE) return
  try {
    await fetch(buildChatStateUrl(chatId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  } catch {
    // Ignore state sync errors.
  }
}

watch(
  () => selectedModel.value,
  (next) => {
    persistModelPreference()
    if (!next) return
    const state = currentChatState.value
    if (state && state.model_id === next) return
    void updateChatState(currentChatId.value, { model_id: next })
  },
)

watch(
  () => useWebSearch.value,
  () => {
    persistWebSearchPreference()
  },
)

watch(
  () => serverStatus.value,
  (next, prev) => {
    if (next === 'online' && prev !== 'online') {
      loadModels()
      scheduleHistoryRefresh()
    }
  },
)

watch(
  () => remoteChatBusy.value,
  (next) => {
    if (next) {
      ensureRemotePendingBubble()
    } else {
      scheduleRemotePendingCleanup()
    }
  },
)

function toggleWebSearch() {
  if (busy.value) return
  const next = !useWebSearch.value
  useWebSearch.value = next
  void updateChatState(currentChatId.value, { use_web: next })
}

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
  } finally {
    loadingModels.value = false
  }
}

async function streamCompletion(model: string, text: string) {
  streamInfo.value = STRATEGY_STREAM_INFO
  const payload = {
    chat_id: currentChatId.value,
    model_id: model,
    prompt: text,
    message_id: createScopedId('message'),
    client_ts: Date.now(),
    stream: true,
    use_web: useWebSearch.value,
  }

  if (remotePendingId.value) {
    const index = messages.value.findIndex((item) => item.id === remotePendingId.value)
    if (index !== -1) {
      messages.value.splice(index, 1)
    }
    remotePendingId.value = null
    clearRemotePendingTimer()
  }

  const message = addMessage('bot', '', Date.now())
  message.raw = ''
  message.html = ''
  message.pending = true
  message.citations = []
  const controller = new AbortController()
  activeAbort.value = controller
  activeMessageId.value = message.id

  let success = false
  let sawDone = false
  const collectedCitations = new Map<string, string | undefined>()

  try {
    const res = await fetch(ENDPOINTS.chat, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      const status = res.ok ? 'unknown' : String(res.status)
      throw new Error(`Chat request failed: ${status}`)
    }

    streamInfo.value = DEFAULT_STREAM_INFO
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

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
          collectCitationsFromEvent(chunk, collectedCitations)

          if (chunk && typeof chunk.stage === 'string') {
            const info = formatStreamInfo(chunk)
            if (info) {
              streamInfo.value = info
            }
            if (chunk.stage === 'topic' && typeof chunk.topic === 'string') {
              currentTopic.value = chunk.topic
              if (typeof chunk.ts === 'number') {
                currentTopicTs.value = normalizeTimestamp(chunk.ts)
              }
            }
            if (chunk.stage === 'final_answer' && typeof chunk.content === 'string') {
              streamInfo.value = ''
              message.pending = false
              message.raw = chunk.content
              message.html = sanitizeMarkdown(message.raw)
              applyCitations(message, collectedCitations)
              await nextTick()
              scrollToBottom()
            }
            if (chunk.stage === 'error') {
              const errorText = typeof chunk.error === 'string' ? chunk.error : 'Web agent error.'
              message.pending = false
              message.raw = `Error: ${errorText}`
              message.html = sanitizeMarkdown(message.raw)
              message.citations = []
              await nextTick()
              scrollToBottom()
            }
            if (chunk.done) {
              sawDone = true
              message.pending = false
              applyCitations(message, collectedCitations)
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
            sawDone = true
            message.pending = false
            applyCitations(message, collectedCitations)
          }
        } catch {
          message.raw += '\n[Stream parse error]'
          message.html = sanitizeMarkdown(message.raw)
        }
      }
    }

    success = message.raw.length > 0 || sawDone
    applyCitations(message, collectedCitations)
    return success
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      message.pending = false
      if (!message.raw) {
        removeMessage(message.id)
      }
      return false
    }
    const messageText = error instanceof Error ? error.message : 'Chat request failed.'
    message.pending = false
    message.raw = `Error: ${messageText}`
    message.html = sanitizeMarkdown(message.raw)
    message.citations = []
    return false
  } finally {
    message.pending = false
    if (activeAbort.value === controller) {
      activeAbort.value = null
      activeMessageId.value = null
    }
  }
}

function cancelActiveRequest() {
  if (!activeAbort.value) return
  activeAbort.value.abort()
  streamInfo.value = ''
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

  localBusy.value = true
  try {
    const ok = await streamCompletion(selectedModel.value, text)
    if (ok) {
      scheduleHistoryRefresh()
      scheduleMetaRefresh(currentChatId.value)
    }
  } finally {
    localBusy.value = false
    streamInfo.value = ''
  }
}

onMounted(loadModelPreference)
onMounted(loadWebSearchPreference)
onMounted(loadModels)
onMounted(startServerHealthPolling)
onMounted(startMobileWidthWatcher)
onMounted(() => {
  openGlobalStream()
  if (currentChatId.value) {
    openChatInfoStream(currentChatId.value)
    syncWebSearchForChat(currentChatId.value)
    syncModelForChat(currentChatId.value)
    void updateChatState(currentChatId.value, { active: true })
  }
})
onBeforeUnmount(() => {
  clearServerHealthTimer()
  clearMetaRefresh()
  closeChatInfoStream()
  closeGlobalStream()
  clearRemotePendingTimer()
  cancelActiveRequest()
})

watch(currentChatId, (chatId) => {
  if (!chatId) {
    closeChatInfoStream()
    return
  }
  openChatInfoStream(chatId)
  syncWebSearchForChat(chatId)
  syncModelForChat(chatId)
  void updateChatState(chatId, { active: true })
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
      padding-left:72px;

      @media (min-width: $bp-mobile) {
        padding-left: 24px;
      }
    }

    .brand {
      font-size: 1.05rem;
      letter-spacing: 0.02em;
      flex: 0 0 auto;
    }

    .header-left {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .topic-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      color: rgba(219, 234, 254, 0.7);
      font-size: 0.78rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(11, 16, 24, 0.35);
      min-height: 32px;
    }

    .topic-label {
      font-weight: 600;
      letter-spacing: 0.04em;
      color: rgba(219, 234, 254, 0.6);
      flex-shrink: 0;
      text-transform: uppercase;
      font-size: 0.6rem;
    }

    .topic-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (min-width: $bp-mobile) {
      .topic-bar {
        padding: 6px 24px;
      }
    }

    .header-right {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex: 0 0 auto;
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
      flex-wrap: nowrap;
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

    .status-alert {
      font-size: 0.72rem;
      color: rgba(255, 215, 209, 0.9);
      white-space: nowrap;
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

  .prompt-controls {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: nowrap;
    min-width: 0;
  }

  .prompt-controls .row {
    flex: 1;
    min-width: 0;
  }

  .web-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: #d7e2f4;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
  }

  .web-toggle:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .web-toggle[aria-pressed='true'] {
    border-color: rgba(79, 167, 255, 0.6);
    background: rgba(79, 167, 255, 0.18);
    color: #f4f8ff;
  }

  .web-toggle-icon {
    display: inline-flex;
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
  }

  .web-toggle-icon svg {
    width: 16px;
    height: 16px;
  }

  .web-toggle-track {
    position: relative;
    width: 34px;
    height: 18px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.4);
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.35);
    transition: background 0.2s ease, box-shadow 0.2s ease;
  }

  .web-toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: #e2e8f0;
    box-shadow: 0 2px 6px rgba(5, 8, 16, 0.35);
    transition: transform 0.2s ease, background 0.2s ease;
  }

  .web-toggle[aria-pressed='true'] .web-toggle-track {
    background: rgba(56, 189, 248, 0.5);
    box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.6);
  }

  .web-toggle[aria-pressed='true'] .web-toggle-knob {
    transform: translateX(16px);
    background: #f8fafc;
  }

  .web-toggle-label {
    display: none;
  }

  @media (min-width: $bp-mobile) {
    .web-toggle-label {
      display: inline;
    }

    .web-toggle-icon {
      display: none;
    }

    .web-toggle {
      padding: 8px 12px;
    }
  }

  .prompt {
    display: block;
  }

  .primary {
    background: linear-gradient(180deg, rgba(111, 195, 255, 0.85), rgba(79, 167, 255, 0.85));
    color: rgba(11, 19, 32, 0.9);
    border: none;
    padding: 12px 20px;
    font-weight: 600;
    border-radius: 12px;
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(10, 16, 26, 0.25);
  }

  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .prompt-field {
    position: relative;
  }

  .prompt-field .input {
    padding-right: 110px;
  }

  .send-inside {
    position: absolute;
    right: 8px;
    bottom: 14px;
    height: 40px;
    padding: 0 18px;
    border-radius: 999px;
  }

  .cancel-inside {
    width: 40px;
    padding: 0;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(148, 163, 184, 0.25);
    border: 1px solid rgba(148, 163, 184, 0.35);
    color: #cbd5e1;
  }

  .cancel-square {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: rgba(203, 213, 225, 0.85);
  }
}
</style>
