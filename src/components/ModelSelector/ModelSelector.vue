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
}>()

const modelProxy = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})
</script>

<style lang="scss">
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.label {
  color: #9aa7bd;
  font-weight: 600;
  font-size: 0.9rem;
}

</style>
