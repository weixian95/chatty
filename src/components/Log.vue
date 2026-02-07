<template>
  <div class="chat-log" ref="logRef">
    <div
      v-for="message in messages"
      :key="message.id"
      class="message"
      :class="message.role"
    >
      <div class="message-body">
        <div v-if="message.html" v-html="message.html"></div>
        <div
          v-else-if="message.pending"
          class="typing-indicator"
          aria-live="polite"
          role="status"
        >
          <div class="loading-dots" aria-hidden="true">
            <span class="loading-dot"></span>
            <span class="loading-dot"></span>
            <span class="loading-dot"></span>
          </div>
          <div v-if="streamInfo" class="loading-text">{{ streamInfo }}</div>
        </div>
      </div>
      <div class="message-time">{{ formatTimestamp(message.ts) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

type ChatMessage = {
  id: string
  role: 'user' | 'bot'
  html: string
  ts?: number | null
  pending?: boolean
}

defineProps<{ messages: ChatMessage[]; streamInfo?: string }>()

const logRef = ref<HTMLDivElement | null>(null)

function formatTimestamp(value?: number | null) {
  if (!value) return '--'
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function scrollToBottom() {
  if (!logRef.value) return
  logRef.value.scrollTop = logRef.value.scrollHeight
}

defineExpose({ scrollToBottom })
</script>

<style lang="scss">
.chat-log {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  padding: 24px;
  box-sizing: border-box;
}

.message {
  max-width: 820px;
  padding: 14px 16px;
  border-radius: 14px;
  line-height: 1.6;
  color: #e6edf7;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 20px rgba(5, 8, 16, 0.35);
}

.message.user {
  align-self: flex-end;
  background: rgba(79, 167, 255, 0.16);
  border-color: rgba(111, 195, 255, 0.35);
  color: #f4f8ff;
}

.message.bot {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.06);
}

.message :is(p, ul, ol, pre) {
  margin: 0 0 10px;
}

.message :is(pre, code) {
  font-family: 'JetBrains Mono', 'SFMono-Regular', monospace;
  background: rgba(10, 14, 22, 0.6);
  border-radius: 10px;
}

.message a {
  color: #8cc8ff;
}

.message a:hover {
  color: #b6ddff;
}

.message pre {
  padding: 12px;
  overflow-x: auto;
}

.message-time {
  margin-top: 8px;
  font-size: 0.72rem;
  color: rgba(231, 237, 247, 0.7);
  text-align: right;
}

.typing-indicator {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.loading-dots {
  display: flex;
  gap: 6px;
  align-items: center;
}

.loading-text {
  font-size: 0.72rem;
  color: rgba(231, 237, 247, 0.78);
  line-height: 1.4;
  word-break: break-word;
}

.loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ecbff;
  opacity: 0.4;
  animation: loadingPulse 1.2s infinite ease-in-out;
}

.loading-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes loadingPulse {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-3px);
  }
}
</style>
