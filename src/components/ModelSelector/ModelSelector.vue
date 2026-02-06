<template>
  <div class="row">
    <label class="label" for="model-select">Model</label>
    <Dropdown
      id="model-select"
      v-model="modelProxy"
      :options="models"
      :loading="loading"
      :disabled="busy"
    />
    <button class="ghost" type="button" :disabled="busy" @click="emit('refresh')">
      Refresh
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Dropdown from './Dropdown.vue'

const props = defineProps<{
  modelValue: string
  models: string[]
  loading: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'refresh'): void
}>()

const modelProxy = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})
</script>

<style lang="scss">
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.label {
  color: #9aa7bd;
  font-weight: 600;
  font-size: 0.9rem;
}

.ghost {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(22, 28, 40, 0.65);
  color: #dbe3ef;
  font: inherit;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ghost:hover:not(:disabled) {
  border-color: rgba(111, 195, 255, 0.5);
  color: #f2f7ff;
}

.ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
