<template>
  <div class="chat-settings-panel" :class="{ collapsed: isCollapsed }">
    <div class="sidebar-header">
        <button class="icon-button" type="button" @click="toggleSidebar">
          {{ isCollapsed ? '>' : 'Menu' }}
        </button>
      </div>
      
    <div class="panel-content">
      <button class="new-chat" type="button" @click="handleNewChat">New chat</button>
      <div v-if="!isCollapsed" class="sidebar-body">
        
        <ul class="conversation-list">
          <li
            v-for="item in conversationItems"
            :key="item.chatId"
            class="conversation-item"
            :class="{ active: item.chatId === currentChatId, disabled: item.disabled }"
            @click="handleOpenConversation(item.chatId)"
          >
            <div class="conversation-row">
              <span class="conversation-title">{{ item.title }}</span>
              <button
                v-if="!item.disabled"
                class="delete-conversation"
                type="button"
                title="Delete chat"
                @click.stop="openDeleteDialog(item.chatId)"
              >
                Delete
              </button>
            </div>
            <span class="conversation-time">{{ item.timestamp }}</span>
          </li>
        </ul>
      </div>
      <button class="refresh-list" type="button" @click="handleRefreshConversations">
        Refresh list
      </button>
    </div>
  </div>
  <teleport to="body">
    <div
      v-if="deleteDialogOpen"
      class="delete-overlay"
      role="presentation"
      @click.self="handleBackdropClick"
    >
      <div class="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <div class="delete-dialog-header">
          <h3 id="delete-title">Delete chat?</h3>
          <p class="delete-dialog-subtitle">
            Delete "<span>{{ deleteTargetTitle }}</span>"? This cannot be undone.
          </p>
        </div>
        <div class="delete-dialog-actions">
          <button
            class="dialog-button ghost"
            type="button"
            :disabled="deleteBusy || props.busy"
            @click="closeDeleteDialog"
          >
            Cancel
          </button>
          <button
            class="dialog-button danger"
            type="button"
            :disabled="deleteBusy || props.busy"
            @click="confirmDeleteConversation"
          >
            Delete chat
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type MessageLike = {
  id: string
  role: 'user' | 'bot'
  raw: string
  ts?: number | null
}

type ChatSummary = {
  chat_id?: string
  title?: string
  chat_title?: string
  summary?: string
  last_updated_ts?: number
  last_message_ts?: number
}

type Conversation = {
  chatId: string
  title: string
  displayTs: number | null
  sortTs: number | null
}

type ConversationItem = {
  chatId: string
  title: string
  timestamp: string
  disabled?: boolean
}

const props = defineProps<{
  currentChatId: string
  busy: boolean
  apiBase: string
  userId: string
}>()

const emit = defineEmits<{
  (event: 'clear'): void
  (event: 'open', payload: { chatId: string; messages: MessageLike[] }): void
}>()

const conversations = ref<Conversation[]>([])
const isCollapsed = ref(false)
const isLoading = ref(false)
const errorMessage = ref('')
const pendingRefreshTimer = ref<number | null>(null)
const pendingChatId = ref<string | null>(null)
const pendingAttempts = ref(0)
const MAX_PENDING_ATTEMPTS = 6
const deleteDialogOpen = ref(false)
const deleteTargetId = ref<string | null>(null)
const deleteTargetTitle = ref('')
const deleteBusy = ref(false)
const handleDeleteKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && deleteDialogOpen.value && !deleteBusy.value && !props.busy) {
    closeDeleteDialog()
  }
}

const conversationItems = computed<ConversationItem[]>(() => {
  if (isLoading.value) {
    return [
      {
        chatId: 'loading',
        title: 'Loading...',
        timestamp: '--',
        disabled: true,
      },
    ]
  }

  if (errorMessage.value) {
    return [
      {
        chatId: 'error',
        title: errorMessage.value,
        timestamp: '--',
        disabled: true,
      },
    ]
  }

  if (conversations.value.length === 0) {
    return [
      {
        chatId: 'empty',
        title: 'No conversations yet',
        timestamp: '--',
        disabled: true,
      },
    ]
  }

  return conversations.value.map(({ chatId, title, displayTs }) => ({
    chatId,
    title,
    timestamp:
      displayTs === null
        ? '--'
        : new Date(displayTs).toLocaleString(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
  }))
})

function toggleSidebar() {
  isCollapsed.value = !isCollapsed.value
}

function handleNewChat() {
  if (props.busy) return
  emit('clear')
}

function findConversationTitle(chatId: string) {
  return conversations.value.find((item) => item.chatId === chatId)?.title ?? fallbackTitle(chatId)
}

function openDeleteDialog(chatId: string) {
  if (isDisabledChatId(chatId) || props.busy) return
  deleteTargetId.value = chatId
  deleteTargetTitle.value = findConversationTitle(chatId)
  deleteDialogOpen.value = true
}

function closeDeleteDialog() {
  deleteDialogOpen.value = false
  deleteTargetId.value = null
  deleteTargetTitle.value = ''
}

function handleBackdropClick() {
  if (deleteBusy.value || props.busy) return
  closeDeleteDialog()
}

function isDisabledChatId(id: string) {
  return id === 'empty' || id === 'loading' || id === 'error'
}

async function handleOpenConversation(id: string) {
  if (isDisabledChatId(id) || props.busy) return
  try {
    const messages = await fetchChatMessages(id)
    emit('open', { chatId: id, messages })
  } catch (err) {
    errorMessage.value = `Chat load error: ${(err as Error).message}`
  }
}

function handleRefreshConversations() {
  void fetchChatList({ showLoading: false })
}

function clearPendingRefresh() {
  if (pendingRefreshTimer.value !== null) {
    window.clearTimeout(pendingRefreshTimer.value)
    pendingRefreshTimer.value = null
  }
  pendingAttempts.value = 0
  pendingChatId.value = null
}

function scheduleTimestampRetry(chatId: string) {
  if (!chatId) return
  if (pendingChatId.value !== chatId) {
    pendingChatId.value = chatId
    pendingAttempts.value = 0
  }
  if (pendingAttempts.value >= MAX_PENDING_ATTEMPTS) return
  if (pendingRefreshTimer.value !== null) {
    window.clearTimeout(pendingRefreshTimer.value)
  }
  pendingAttempts.value += 1
  const delay = 500 + pendingAttempts.value * 350
  pendingRefreshTimer.value = window.setTimeout(() => {
    void fetchChatMeta(chatId)
  }, delay)
}

function buildListUrl() {
  const url = new URL(`${props.apiBase}/api/chats`)
  url.searchParams.set('user_id', props.userId)
  return url.toString()
}

function buildMessagesUrl(chatId: string) {
  const url = new URL(`${props.apiBase}/api/chats/${encodeURIComponent(chatId)}/messages`)
  url.searchParams.set('user_id', props.userId)
  url.searchParams.set('offset', '0')
  url.searchParams.set('limit', '200')
  return url.toString()
}

function buildChatMetaUrl(chatId: string) {
  const url = new URL(`${props.apiBase}/api/chats/${encodeURIComponent(chatId)}`)
  url.searchParams.set('user_id', props.userId)
  return url.toString()
}

function buildDeleteUrl(chatId: string) {
  const url = new URL(`${props.apiBase}/api/chats/${encodeURIComponent(chatId)}`)
  url.searchParams.set('user_id', props.userId)
  return url.toString()
}

function extractTitle(chat: ChatSummary) {
  const candidates = [chat.title, chat.chat_title, chat.summary]
  const trimmed = candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim()
  if (!trimmed) return null
  return trimmed.length > 54 ? `${trimmed.slice(0, 54)}...` : trimmed
}

function fallbackTitle(chatId: string) {
  return `Chat ${chatId.slice(0, 8)}`
}

function normalizeTimestamp(value: unknown) {
  const raw = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(raw) || raw <= 0) return null
  return raw < 1_000_000_000_000 ? raw * 1000 : raw
}

async function fetchChatList(options: { showLoading?: boolean } = {}) {
  if (!props.userId || !props.apiBase) return
  const showLoading = options.showLoading ?? conversations.value.length === 0
  if (showLoading) {
    isLoading.value = true
  }
  errorMessage.value = ''
  try {
    const res = await fetch(buildListUrl())
    if (!res.ok) throw new Error(`List failed: ${res.status}`)
    const data = await res.json()
    const chats = Array.isArray(data.chats) ? data.chats : []
    const existingById = new Map(conversations.value.map((item) => [item.chatId, item]))
    conversations.value = chats
      .map((chat: ChatSummary) => {
        const chatId = typeof chat.chat_id === 'string' ? chat.chat_id : ''
        if (!chatId) return null
        const updated = normalizeTimestamp(chat.last_updated_ts ?? chat.last_message_ts)
        const existing = existingById.get(chatId)
        const displayTs = updated ?? existing?.displayTs ?? null
        const sortTs =
          updated ??
          existing?.sortTs ??
          (chatId === props.currentChatId ? Date.now() : null)
        const title = extractTitle(chat) ?? existing?.title ?? fallbackTitle(chatId)
        return {
          chatId,
          title,
          displayTs,
          sortTs,
        }
      })
      .filter((item): item is Conversation => item !== null)
      .sort((a, b) => (b.sortTs ?? 0) - (a.sortTs ?? 0))

    const current = conversations.value.find((item) => item.chatId === props.currentChatId)
    if (current && current.displayTs === null) {
      scheduleTimestampRetry(current.chatId)
    } else {
      clearPendingRefresh()
    }
  } catch (err) {
    conversations.value = []
    errorMessage.value = `Chat list error: ${(err as Error).message}`
  } finally {
    if (showLoading) {
      isLoading.value = false
    }
  }
}

async function fetchChatMeta(chatId: string) {
  if (!props.userId || !props.apiBase || !chatId) return
  try {
    const res = await fetch(buildChatMetaUrl(chatId))
    if (!res.ok) throw new Error(`Meta failed: ${res.status}`)
    const chat: ChatSummary = await res.json()
    const updated = normalizeTimestamp(chat.last_updated_ts ?? chat.last_message_ts)
    const index = conversations.value.findIndex((item) => item.chatId === chatId)
    if (index === -1) {
      void fetchChatList({ showLoading: false })
      return
    }
    const existing = conversations.value[index]
    const title = extractTitle(chat) ?? existing.title ?? fallbackTitle(chatId)
    const displayTs = updated ?? existing.displayTs ?? null
    const sortTs = updated ?? existing.sortTs ?? null
    conversations.value.splice(index, 1, {
      ...existing,
      title,
      displayTs,
      sortTs,
    })
    if (updated === null) {
      scheduleTimestampRetry(chatId)
    } else {
      clearPendingRefresh()
    }
  } catch (err) {
    errorMessage.value = `Chat meta error: ${(err as Error).message}`
  }
}

async function fetchChatMessages(chatId: string): Promise<MessageLike[]> {
  const res = await fetch(buildMessagesUrl(chatId))
  if (!res.ok) throw new Error(`Messages failed: ${res.status}`)
  const data = await res.json()
  const items = Array.isArray(data.messages) ? data.messages : []
  return items
    .map((item: { role?: string; content?: string; ts?: number; message_id?: string }, index: number) => {
      const role = item.role === 'assistant' ? 'bot' : 'user'
      const ts = normalizeTimestamp(item.ts)
      const id =
        typeof item.message_id === 'string'
          ? item.message_id
          : `${(ts ?? Date.now())}-${index}-${Math.random().toString(16).slice(2)}`
      return {
        id,
        role,
        raw: typeof item.content === 'string' ? item.content : '',
        ts,
      }
    })
    .filter((message) => message.raw.trim().length > 0)
}

async function confirmDeleteConversation() {
  const chatId = deleteTargetId.value
  if (!chatId || deleteBusy.value || props.busy) return
  deleteBusy.value = true
  try {
    const res = await fetch(buildDeleteUrl(chatId), { method: 'DELETE' })
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
    conversations.value = conversations.value.filter((item) => item.chatId !== chatId)
    if (chatId === props.currentChatId) {
      emit('clear')
    }
    void fetchChatList({ showLoading: false })
  } catch (err) {
    errorMessage.value = `Delete error: ${(err as Error).message}`
  } finally {
    deleteBusy.value = false
    closeDeleteDialog()
  }
}

onMounted(fetchChatList)
onMounted(() => {
  window.addEventListener('keydown', handleDeleteKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleDeleteKeydown)
})
watch(() => props.userId, () => {
  clearPendingRefresh()
  fetchChatList({ showLoading: false })
})
watch(() => props.apiBase, () => {
  clearPendingRefresh()
  fetchChatList({ showLoading: false })
})
watch(() => props.currentChatId, () => {
  clearPendingRefresh()
  fetchChatList({ showLoading: false })
})

defineExpose({ refreshList: fetchChatList })
</script>

<style lang="scss">
.chat {
  .chat-settings-panel {
    width: 320px;
    height: 100%;
    background-color: #0f141c;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    padding: 16px;
    box-sizing: border-box;
    display: flex;
    gap: 12px;
    flex-direction: column;
    transition: width 0.3s;

    &.collapsed {
      width: 72px;

      .panel-content {
        opacity: 0;
        pointer-events: none;
      }
    }
  }

  .panel-content {
    display: flex;
    gap: 16px;
    flex-direction: column;
    width: 288px;
    transition: opacity 0.3s;
    height: calc(100% - 50px);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .icon-button {
    font: inherit;
    font-weight: 600;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(22, 28, 40, 0.9);
    color: #e7edf7;
    cursor: pointer;
  }

  .sidebar-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .new-chat {
    border: 1px solid rgba(111, 195, 255, 0.3);
    background: rgba(79, 167, 255, 0.12);
    color: #e7edf7;
    font: inherit;
    padding: 10px 12px;
    border-radius: 12px;
    cursor: pointer;
  }

  .conversation-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-x: hidden;
    overflow-y: auto;
    min-height: 0;
    flex: 1;
  }

  .conversation-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid transparent;
    background: rgba(16, 23, 34, 0.7);
    cursor: pointer;
  }

  .conversation-item:hover {
    background: rgba(22, 30, 42, 0.8);
  }

  .conversation-item.active {
    border-color: rgba(111, 195, 255, 0.55);
    background: rgba(18, 30, 46, 0.9);
  }

  .conversation-item.disabled {
    cursor: default;
    opacity: 0.7;
  }

  .conversation-item.disabled:hover {
    background: rgba(16, 23, 34, 0.7);
  }

  .conversation-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .conversation-title {
    font-weight: 600;
    color: #e7edf7;
    font-size: 0.95rem;
  }

  .delete-conversation {
    opacity: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(22, 28, 40, 0.65);
    color: #cfd8e6;
    font: inherit;
    font-size: 0.75rem;
    padding: 4px 8px;
    border-radius: 8px;
    cursor: pointer;
    transition: opacity 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .conversation-item:hover .delete-conversation,
  .conversation-item.active .delete-conversation {
    opacity: 1;
  }

  .delete-conversation:hover {
    border-color: rgba(255, 138, 122, 0.6);
    color: #ffd6cf;
  }

  .conversation-time {
    color: #6b7485;
    font-size: 0.75rem;
  }

  .refresh-list {
    margin-top: auto;
    border: 1px solid rgba(255, 138, 122, 0.3);
    background: rgba(255, 138, 122, 0.08);
    color: #ffb3a8;
    font: inherit;
    padding: 10px 12px;
    border-radius: 12px;
    cursor: pointer;
  }

  .refresh-list:hover {
    border-color: rgba(255, 138, 122, 0.6);
    color: #ffd6cf;
  }
}

.delete-overlay {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 14, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  backdrop-filter: blur(6px);
}

.delete-dialog {
  width: min(420px, 90vw);
  background: #101723;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  padding: 20px;
  color: #e7edf7;
}

.delete-dialog-header h3 {
  margin: 0 0 6px;
  font-size: 1.1rem;
}

.delete-dialog-subtitle {
  margin: 0;
  color: rgba(231, 237, 247, 0.72);
  font-size: 0.9rem;
  line-height: 1.5;
}

.delete-dialog-subtitle span {
  color: #f8fafc;
  font-weight: 600;
}

.delete-dialog-actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.dialog-button {
  border-radius: 10px;
  padding: 10px 14px;
  font: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.dialog-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dialog-button.ghost {
  background: rgba(255, 255, 255, 0.04);
  color: #dbe5f5;
  border-color: rgba(255, 255, 255, 0.12);
}

.dialog-button.ghost:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.3);
}

.dialog-button.danger {
  background: rgba(239, 68, 68, 0.18);
  color: #ffe3e0;
  border-color: rgba(239, 68, 68, 0.4);
}

.dialog-button.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.28);
  border-color: rgba(239, 68, 68, 0.6);
}
</style>
