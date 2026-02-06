<template>
  <div>
    <label class="sr-only" :for="inputId">Prompt</label>
    <textarea
      :id="inputId"
      class="input"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :value="modelValue"
      :required="required"
      @input="handleInput"
      @keydown.ctrl.enter.prevent="emit('submit')"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled: boolean
    required?: boolean
    rows?: number
    placeholder?: string
    inputId?: string
  }>(),
  {
    required: true,
    rows: 3,
    placeholder: 'Ask something...',
    inputId: 'prompt-input',
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'submit'): void
}>()

const inputId = computed(() => props.inputId)

function handleInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
}
</script>

<style lang="scss">
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.input {
  width: 100%;
  resize: vertical;
  min-height: 56px;
  max-height: 200px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(12, 18, 28, 0.9);
  color: #e7edf7;
  font: inherit;
  line-height: 1.5;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.input::placeholder {
  color: rgba(154, 167, 189, 0.8);
}

.input:focus {
  outline: none;
  border-color: rgba(111, 195, 255, 0.6);
  box-shadow: 0 0 0 2px rgba(111, 195, 255, 0.15);
}

.input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
