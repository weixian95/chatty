<template>
  <main class="app">
      <ChatApp />
  </main>
</template>

<script setup lang="ts">
import ChatApp from './components/ChatApp.vue'
</script>

<style lang="scss">
.app {
  display: flex;
  flex-direction: column;
}
</style>
