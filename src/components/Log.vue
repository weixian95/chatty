<template>
  <div class="chat-log" ref="logRef">
    <div
      v-for="message in messages"
      :key="message.id"
      class="message"
      :class="message.role"
    >
      <div class="message-body" v-html="message.html"></div>
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
}

defineProps<{ messages: ChatMessage[] }>()

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
</style>
