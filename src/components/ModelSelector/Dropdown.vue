<template>
  <select
    :id="id"
    class="select"
    :disabled="disabled"
    :value="modelValue"
    @change="handleChange"
  >
    <option v-if="loading" value="">Loading models...</option>
    <option v-else-if="options.length === 0" value="">No models found</option>
    <option v-else v-for="option in options" :key="option" :value="option">
      {{ option }}
    </option>
  </select>
</template>

<script setup lang="ts">
defineProps<{
  id: string
  modelValue: string
  options: string[]
  loading: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

function handleChange(event: Event) {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value)
}
</script>

<style lang="scss">
.select {
  width: 100%;
  max-width: 360px;
  padding: 10px 36px 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background-color: rgba(12, 18, 28, 0.9);
  color: #e7edf7;
  font: inherit;
  appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, #9aa7bd 50%),
    linear-gradient(135deg, #9aa7bd 50%, transparent 50%);
  background-position:
    calc(100% - 18px) 55%,
    calc(100% - 12px) 55%;
  background-size: 6px 6px, 6px 6px;
  background-repeat: no-repeat;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.select:focus {
  outline: none;
  border-color: rgba(111, 195, 255, 0.6);
  box-shadow: 0 0 0 2px rgba(111, 195, 255, 0.15);
}

.select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
