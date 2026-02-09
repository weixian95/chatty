<template>
  <div ref="panelRef" class="chat-settings-panel" :class="{ collapsed: isCollapsed }">
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
      <button
        v-if="!isCollapsed"
        class="remove-all"
        type="button"
        :disabled="props.busy || removeAllBusy || conversations.length === 0"
        @click="openRemoveAllDialog"
      >
        Remove all chats
      </button>
    </div>
  </div>
  <teleport to="body">
    <div v-if="props.isMobile && !isCollapsed" class="panel-backdrop" aria-hidden="true"></div>
  </teleport>
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
  <teleport to="body">
    <div
      v-if="removeAllDialogOpen"
      class="delete-overlay"
      role="presentation"
      @click.self="handleBackdropClick"
    >
      <div class="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-all-title">
        <div class="delete-dialog-header">
          <h3 id="remove-all-title">Remove all chats?</h3>
          <p class="delete-dialog-subtitle">
            This will permanently delete all chat history. This cannot be undone.
          </p>
        </div>
        <div class="delete-dialog-actions">
          <button
            class="dialog-button ghost"
            type="button"
            :disabled="removeAllBusy || props.busy"
            @click="closeRemoveAllDialog"
          >
            Cancel
          </button>
          <button
            class="dialog-button danger"
            type="button"
            :disabled="removeAllBusy || props.busy"
            @click="confirmRemoveAll"
          >
            Remove all
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
  raw_count?: number
}

type ChatListUpdate = {
  type?: 'added' | 'updated' | 'deleted'
  chat?: ChatSummary
  chat_id?: string
}

type ChatInfoUpdate = {
  type?: string
  chat_id?: string
  content?: {
    title?: string
    topic?: string
  }
}

type Conversation = {
  chatId: string
  title: string
  topic: string | null
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
  isMobile: boolean
}>()

const emit = defineEmits<{
  (event: 'clear'): void
  (event: 'open', payload: { chatId: string; messages: MessageLike[] }): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const conversations = ref<Conversation[]>([])
const isCollapsed = ref(false)
const isLoading = ref(false)
const errorMessage = ref('')
const pendingRefreshTimer = ref<number | null>(null)
const pendingChatId = ref<string | null>(null)
const pendingAttempts = ref(0)
const MAX_PENDING_ATTEMPTS = 6
const removeAllDialogOpen = ref(false)
const removeAllBusy = ref(false)
const deleteDialogOpen = ref(false)
const deleteTargetId = ref<string | null>(null)
const deleteTargetTitle = ref('')
const deleteBusy = ref(false)
const handleDeleteKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || props.busy) return
  if (deleteDialogOpen.value && !deleteBusy.value) {
    closeDeleteDialog()
  }
  if (removeAllDialogOpen.value && !removeAllBusy.value) {
    closeRemoveAllDialog()
  }
}

const handleDocumentPointer = (event: PointerEvent) => {
  if (!props.isMobile || isCollapsed.value) return
  if (deleteDialogOpen.value || removeAllDialogOpen.value) return
  const target = event.target as Node | null
  const panel = panelRef.value
  if (panel && target && panel.contains(target)) return
  isCollapsed.value = true
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

function collapseSidebar() {
  if (props.isMobile) {
    isCollapsed.value = true
  }
}

function handleNewChat() {
  if (props.busy) return
  emit('clear')
  if (props.isMobile) {
    isCollapsed.value = true
  }
}

function findConversationTitle(chatId: string) {
  return conversations.value.find((item) => item.chatId === chatId)?.title ?? fallbackTitle(chatId)
}

function openRemoveAllDialog() {
  if (props.busy || removeAllBusy.value || conversations.value.length === 0) return
  if (deleteDialogOpen.value) {
    closeDeleteDialog()
  }
  removeAllDialogOpen.value = true
}

function closeRemoveAllDialog() {
  removeAllDialogOpen.value = false
}

function handleBackdropClick() {
  if (props.busy) return
  if (deleteDialogOpen.value && !deleteBusy.value) {
    closeDeleteDialog()
  }
  if (removeAllDialogOpen.value && !removeAllBusy.value) {
    closeRemoveAllDialog()
  }
}

function openDeleteDialog(chatId: string) {
  if (isDisabledChatId(chatId) || props.busy) return
  if (!props.isMobile) {
    void handleDeleteConversation(chatId)
    return
  }
  if (removeAllDialogOpen.value) {
    closeRemoveAllDialog()
  }
  deleteTargetId.value = chatId
  deleteTargetTitle.value = findConversationTitle(chatId)
  deleteDialogOpen.value = true
}

function closeDeleteDialog() {
  deleteDialogOpen.value = false
  deleteTargetId.value = null
  deleteTargetTitle.value = ''
}

function isDisabledChatId(id: string) {
  return id === 'empty' || id === 'loading' || id === 'error'
}

async function handleOpenConversation(id: string) {
  if (isDisabledChatId(id) || props.busy) return
  try {
    const messages = await fetchChatMessages(id)
    await fetchChatMeta(id)
    emit('open', { chatId: id, messages })
    if (props.isMobile) {
      isCollapsed.value = true
    }
  } catch (err) {
    errorMessage.value = `Chat load error: ${(err as Error).message}`
  }
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
  return `${props.apiBase}/api/chats`
}

function buildMessagesUrl(chatId: string) {
  const url = new URL(`${props.apiBase}/api/chats/${encodeURIComponent(chatId)}/messages`)
  url.searchParams.set('offset', '0')
  url.searchParams.set('limit', '200')
  return url.toString()
}

function buildChatMetaUrl(chatId: string) {
  return `${props.apiBase}/api/chats/${encodeURIComponent(chatId)}`
}

function buildDeleteUrl(chatId: string) {
  return `${props.apiBase}/api/chats/${encodeURIComponent(chatId)}`
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

function normalizeConversation(chat: ChatSummary, existing?: Conversation | null) {
  const chatId = typeof chat.chat_id === 'string' ? chat.chat_id : ''
  if (!chatId) return null
  const updated = normalizeTimestamp(chat.last_updated_ts ?? chat.last_message_ts)
  const rawTitle = extractTitle(chat)
  const topic =
    typeof chat.topic === 'string' && chat.topic.trim().length > 0 ? chat.topic.trim() : null
  const rawCount = typeof chat.raw_count === 'number' ? chat.raw_count : null
  if ((!updated && !rawTitle && !topic) || (rawCount !== null && rawCount <= 0)) {
    return null
  }
  const displayTs = updated ?? existing?.displayTs ?? null
  const sortTs = updated ?? existing?.sortTs ?? (chatId === props.currentChatId ? Date.now() : null)
  const title = rawTitle ?? existing?.title ?? fallbackTitle(chatId)
  return {
    chatId,
    title,
    topic,
    displayTs,
    sortTs,
  }
}

function buildConversationList(chats: ChatSummary[]) {
  const seen = new Set<string>()
  const existingById = new Map(conversations.value.map((item) => [item.chatId, item]))
  return chats
    .map((chat) => {
      const chatId = typeof chat.chat_id === 'string' ? chat.chat_id : ''
      if (!chatId) return null
      if (seen.has(chatId)) return null
      seen.add(chatId)
      const existing = existingById.get(chatId)
      return normalizeConversation(chat, existing)
    })
    .filter((item): item is Conversation => item !== null)
    .sort((a, b) => (b.sortTs ?? 0) - (a.sortTs ?? 0))
}

async function fetchChatList(options: { showLoading?: boolean } = {}) {
  if (!props.apiBase) return
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
    conversations.value = buildConversationList(chats)

    const current = conversations.value.find((item) => item.chatId === props.currentChatId)
    if (current && current.displayTs === null) {
      scheduleTimestampRetry(current.chatId)
    } else {
      clearPendingRefresh()
    }
  } catch (err) {
    conversations.value = []
    errorMessage.value = ''
  } finally {
    if (showLoading) {
      isLoading.value = false
    }
  }
}

async function fetchChatMeta(chatId: string) {
  if (!props.apiBase || !chatId) return
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
    .map((item: { role?: string; content?: string; ts?: number; message_id?: string; polished?: boolean }, index: number) => {
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
        polished: typeof item.polished === 'boolean' ? item.polished : undefined,
      }
    })
    .filter((message) => message.raw.trim().length > 0)
}

async function handleDeleteConversation(chatId: string) {
  if (isDisabledChatId(chatId) || props.busy) return
  try {
    const res = await fetch(buildDeleteUrl(chatId), {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
    conversations.value = conversations.value.filter((item) => item.chatId !== chatId)
    if (chatId === props.currentChatId) {
      emit('clear')
    }
    void fetchChatList({ showLoading: false })
  } catch (err) {
    errorMessage.value = `Delete error: ${(err as Error).message}`
  }
}

async function confirmDeleteConversation() {
  const chatId = deleteTargetId.value
  if (!chatId || deleteBusy.value || props.busy) return
  deleteBusy.value = true
  try {
    await handleDeleteConversation(chatId)
  } finally {
    deleteBusy.value = false
    closeDeleteDialog()
  }
}

async function confirmRemoveAll() {
  if (props.busy || removeAllBusy.value) return
  removeAllBusy.value = true
  try {
    const ids = conversations.value.map((item) => item.chatId)
    for (const chatId of ids) {
      try {
        const res = await fetch(buildDeleteUrl(chatId), {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      } catch {
        // keep going
      }
    }
    conversations.value = []
    emit('clear')
    void fetchChatList({ showLoading: false })
  } finally {
    removeAllBusy.value = false
    closeRemoveAllDialog()
  }
}

onMounted(fetchChatList)
onMounted(() => {
  if (props.isMobile) {
    isCollapsed.value = true
  }
  window.addEventListener('keydown', handleDeleteKeydown)
  document.addEventListener('pointerdown', handleDocumentPointer)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleDeleteKeydown)
  document.removeEventListener('pointerdown', handleDocumentPointer)
})
watch(() => props.apiBase, () => {
  clearPendingRefresh()
  fetchChatList({ showLoading: false })
})
watch(() => props.currentChatId, () => {
  clearPendingRefresh()
  fetchChatList({ showLoading: false })
})

function applyChatInfoUpdate(update: ChatInfoUpdate) {
  if (!update || typeof update.chat_id !== 'string') return
  const chatId = update.chat_id
  const index = conversations.value.findIndex((item) => item.chatId === chatId)
  if (index === -1) {
    void fetchChatList({ showLoading: false })
    return
  }
  const existing = conversations.value[index]
  if (update.type === 'title' && update.content?.title) {
    conversations.value.splice(index, 1, {
      ...existing,
      title: update.content.title,
    })
  }
}

function applyChatListSnapshot(chats: ChatSummary[]) {
  conversations.value = buildConversationList(chats)
  const current = conversations.value.find((item) => item.chatId === props.currentChatId)
  if (current && current.displayTs === null) {
    scheduleTimestampRetry(current.chatId)
  } else {
    clearPendingRefresh()
  }
}

function applyChatListUpdate(update: ChatListUpdate) {
  if (!update || !update.type) return
  if (update.type === 'deleted') {
    const chatId = typeof update.chat_id === 'string' ? update.chat_id : ''
    if (!chatId) return
    conversations.value = conversations.value.filter((item) => item.chatId !== chatId)
    return
  }
  const payload = update.chat
  if (!payload) return
  const chatId = typeof payload.chat_id === 'string' ? payload.chat_id : ''
  if (!chatId) return
  const index = conversations.value.findIndex((item) => item.chatId === chatId)
  const existing = index >= 0 ? conversations.value[index] : null
  const normalized = normalizeConversation(payload, existing)
  if (!normalized) {
    if (index >= 0) {
      conversations.value.splice(index, 1)
    }
    return
  }
  if (index >= 0) {
    conversations.value.splice(index, 1, normalized)
  } else {
    conversations.value.push(normalized)
  }
  conversations.value.sort((a, b) => (b.sortTs ?? 0) - (a.sortTs ?? 0))
}

defineExpose({
  refreshList: fetchChatList,
  applyChatInfoUpdate,
  applyChatListSnapshot,
  applyChatListUpdate,
})
</script>

<style lang="scss">
.chat {
  .chat-settings-panel {
    position: absolute;
    z-index: 2;
    width: 320px;
    height: 100%;
    background: rgba(15, 20, 28, 0.8);
    backdrop-filter: blur(16px);
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
    display: flex;
    gap: 12px;
    flex-direction: column;
    transition: width 0.3s;

    @media (min-width: $bp-mobile) {
      position: relative;
      background: #0f141c;
      backdrop-filter: none;
    }

    &.collapsed {
      width: 0;
      overflow: visible;

      @media (min-width: $bp-mobile) {
        width: 64px;
      }

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
    width: 320px;
    box-sizing: border-box;
    padding: 16px;
    transition: opacity 0.3s;
    height: calc(100% - 80px);
  }

  .sidebar-header {
    position: relative;
    padding: 16px;
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

  .remove-all {
    margin-top: auto;
    border: 1px solid rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.12);
    color: #ffd1cb;
    font: inherit;
    padding: 10px 12px;
    border-radius: 12px;
    cursor: pointer;
  }

  .remove-all:hover:not(:disabled) {
    border-color: rgba(239, 68, 68, 0.6);
    background: rgba(239, 68, 68, 0.2);
  }

  .remove-all:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
    opacity: 1;
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

  @media (min-width: $bp-mobile) {
    .delete-conversation {
      opacity: 0;
    }

    .conversation-item:hover .delete-conversation,
    .conversation-item.active .delete-conversation {
      opacity: 1;
    }
  }

  .delete-conversation:hover {
    border-color: rgba(255, 138, 122, 0.6);
    color: #ffd6cf;
  }

  .conversation-time {
    color: #6b7485;
    font-size: 0.75rem;
  }

}

.panel-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 14, 0.2);
  z-index: 1;
  pointer-events: none;
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
