<template>
  <div v-if="draft" class="cb px-box" :class="tone" role="dialog" aria-label="Add a note">
    <p class="cb__head">
      <span class="cb__mark">{{ draft.rating === 1 ? '▲' : draft.rating === -1 ? '▼' : '♪' }}</span>
      <span>{{ draft.rating === 0 ? 'NOTE' : 'WHY?' }}</span>
      <span class="cb__at"><PxText :text="where" /></span>
    </p>
    <textarea
      ref="field"
      v-model="text"
      class="cb__field"
      rows="2"
      maxlength="1000"
      :placeholder="draft.rating === 0 ? 'what do you hear...' : 'a few words, or just close'"
      @keydown.enter.exact.prevent="send"
      @keydown.esc.prevent="close"
    />
    <div class="cb__row">
      <button type="button" class="px-btn px-btn--dim" @click="close">{{ draft.rating === 0 ? 'CANCEL' : 'CLOSE' }}</button>
      <button type="button" class="px-btn px-btn--pink" :disabled="!text.trim()" @click="send">SEND ↵</button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The small box that opens after ▲ / ▼ (the thumb is already saved) or NOTE:
 * words go on the same feedback. Enter sends, Esc closes.
 */
import { computed, nextTick, ref, watch } from 'vue'

const { draft, comment, dismiss } = useFeedback()
const text = ref('')
const field = ref<HTMLTextAreaElement | null>(null)

const tone = computed(() => (draft.value?.rating === -1 ? 'cb--down' : draft.value?.rating === 1 ? 'cb--up' : 'cb--note'))
const where = computed(() => {
  const s = draft.value?.snapshot
  if (!s) return ''
  return [s.chords.join(' '), s.bar >= 0 ? `BAR ${s.bar}` : ''].filter(Boolean).join(' · ')
})

watch(draft, (d, old) => {
  if (d && d !== old) {
    text.value = ''
    void nextTick(() => field.value?.focus())
  }
})

function send(): void {
  const t = text.value
  text.value = ''
  void comment(t)
  field.value?.blur()
}

function close(): void {
  text.value = ''
  dismiss()
  field.value?.blur()
}
</script>

<style scoped>
.cb {
  --px-edge: var(--pink);
  position: absolute;
  z-index: 20;
  right: calc(16px + var(--safe-r));
  top: calc(72px + var(--safe-t));
  width: min(420px, calc(100vw - 32px - var(--safe-l) - var(--safe-r)));
  padding: 14px 14px 12px;
  background: var(--bg);
  font-size: 16px;
  line-height: 20px;
}
.cb--up { --px-edge: var(--cyan); }

/* Phones: at the top, clear of the on-screen keyboard. */
@media (max-width: 700px) {
  .cb { top: calc(12px + var(--safe-t)); left: calc(16px + var(--safe-l)); right: calc(16px + var(--safe-r)); width: auto; }
}
.cb p { margin: 0; }

.cb__head { display: flex; gap: 8px; align-items: baseline; color: var(--ink); }
.cb__mark { color: var(--px-edge); }
.cb__at { margin-left: auto; color: var(--subtle); --pxt-shadow: 2px 2px 0 #0b0616; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.cb__field {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 8px;
  border: 0;
  border-radius: 0;
  background: var(--bg-3);
  box-shadow: inset 0 0 0 2px var(--edge-dim);
  color: var(--ink);
  font-family: var(--font-pixel);
  font-size: 16px;
  line-height: 20px;
  resize: none;
  user-select: text;
  -webkit-user-select: text;
  -webkit-font-smoothing: none;
}
.cb__field:focus { outline: none; box-shadow: inset 0 0 0 2px var(--px-edge); }
.cb__field::placeholder { color: var(--subtle); }

.cb__row { display: flex; justify-content: flex-end; gap: 12px; margin-top: 12px; }
</style>
