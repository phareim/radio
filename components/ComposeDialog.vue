<template>
  <div class="cd__veil" @click.self="close">
    <div class="cd px-box px-box--gold" role="dialog" aria-label="Compose a new place">
      <p class="cd__title">◈ NEW PLACE</p>

      <template v-if="compose.phase === 'idle' || compose.phase === 'error'">
        <textarea
          ref="field"
          v-model="prompt"
          class="cd__field"
          rows="4"
          maxlength="2000"
          placeholder="describe a place and its music..."
          @keydown.esc.prevent="close"
          @keydown.enter.meta.prevent="go"
          @keydown.enter.ctrl.prevent="go"
        />
        <div class="cd__base">
          <span>START FROM</span>
          <select v-model="base" class="cd__select" aria-label="Base landscape">
            <option value="">NOTHING</option>
            <option v-for="L in BUILTIN" :key="L.id" :value="L.id">{{ L.name.toUpperCase() }}</option>
          </select>
        </div>
        <p v-if="compose.phase === 'error'" class="cd__err">{{ compose.message }}</p>
        <div class="cd__row">
          <button type="button" class="px-btn px-btn--dim" @click="close">CANCEL</button>
          <button type="button" class="px-btn px-btn--gold" :disabled="!prompt.trim()" @click="go">COMPOSE</button>
        </div>
      </template>

      <template v-else-if="compose.phase === 'working'">
        <div class="cd__work">
          <span class="cd__spin" aria-hidden="true"><span v-for="i in 8" :key="i" /></span>
          <div>
            <p class="cd__status">OPUS IS COMPOSING...</p>
            <p class="cd__sub">{{ compose.status === 'queued' ? 'WAITING ITS TURN' : 'ONE TO THREE MINUTES' }} · {{ elapsed }}</p>
          </div>
        </div>
        <p class="cd__quote">“{{ compose.prompt }}”</p>
        <div class="cd__row">
          <button type="button" class="px-btn px-btn--dim" @click="close">KEEP LISTENING</button>
        </div>
      </template>

      <template v-else-if="compose.phase === 'done'">
        <p class="cd__done" :style="{ color: compose.landscape.accent }">{{ compose.landscape.name }}</p>
        <p class="cd__sub">{{ compose.landscape.blurb }}</p>
        <div class="cd__row">
          <button type="button" class="px-btn px-btn--dim" @click="finish(false)">LATER</button>
          <button type="button" class="px-btn px-btn--gold" @click="finish(true)">GO THERE ▶</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Ask Opus for a new place: a description and, optionally, a built-in to
 * start from. The compose runs as a job on Sleeper; this box shows the wait
 * and, when the place has arrived and validated, offers to go there. It can
 * be closed while Opus works; the dial's + NEW PLACE blinks until it is done.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { BUILTIN } from '~/engine/landscapes/index.ts'

const emit = defineEmits<{ close: [] }>()
const { compose, start, reset } = usePlaces()
const { set } = useRadio()

const prompt = ref('')
const base = ref('')
const field = ref<HTMLTextAreaElement | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const elapsed = computed(() => {
  if (compose.value.phase !== 'working') return ''
  const s = Math.max(0, Math.round((now.value - compose.value.since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

function go(): void {
  if (!prompt.value.trim()) return
  void start(prompt.value, base.value)
}

function close(): void {
  if (compose.value.phase === 'error') reset()
  emit('close')
}

function finish(travel: boolean): void {
  if (compose.value.phase === 'done' && travel) set({ landscape: compose.value.landscape.id })
  reset()
  emit('close')
}

onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 1000)
  void nextTick(() => field.value?.focus())
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.cd__veil {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: max(16px, var(--safe-t)) calc(16px + var(--safe-r)) calc(16px + var(--app-safe-bottom)) calc(16px + var(--safe-l));
  background: rgba(11, 6, 22, 0.6);
}

.cd {
  width: min(520px, 100%);
  padding: 16px 16px 14px;
  background: var(--bg);
  font-size: 16px;
  line-height: 20px;
  color: var(--ink);
}
.cd p { margin: 0; }

@media (max-width: 700px) {
  .cd__veil { place-items: start center; padding-top: calc(12px + var(--safe-t)); }
}

.cd__title { color: var(--gold); text-shadow: 2px 2px 0 var(--bg); margin-bottom: 12px !important; }

.cd__field {
  display: block;
  width: 100%;
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
.cd__field:focus { outline: none; box-shadow: inset 0 0 0 2px var(--gold); }
.cd__field::placeholder { color: var(--subtle); }

.cd__base {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  color: var(--muted);
}
.cd__select {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: var(--bg-3);
  box-shadow: inset 0 0 0 2px var(--edge-dim);
  color: var(--ink);
  font-family: var(--font-pixel);
  font-size: 16px;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.cd__select:focus { outline: none; box-shadow: inset 0 0 0 2px var(--gold); }

.cd__err { margin-top: 12px !important; color: var(--pink); text-transform: uppercase; }

.cd__row { display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; }

.cd__work { display: flex; align-items: center; gap: 16px; }
.cd__status { color: var(--gold); }
.cd__sub { color: var(--muted); text-transform: uppercase; margin-top: 4px !important; }
.cd__quote { margin-top: 12px !important; color: var(--subtle); text-transform: none; max-height: 60px; overflow: hidden; }
.cd__done { font-size: 32px; line-height: 36px; text-transform: uppercase; text-shadow: 4px 4px 0 var(--bg); margin-bottom: 8px !important; }

/* A ring of eight pixel blocks, one lit at a time, stepping round. */
.cd__spin {
  position: relative;
  flex: none;
  width: 32px;
  height: 32px;
}
.cd__spin span {
  position: absolute;
  width: 8px;
  height: 8px;
  background: color-mix(in srgb, var(--gold) 25%, var(--bg));
  animation: cd-spin 0.8s steps(1) infinite;
}
.cd__spin span:nth-child(1) { left: 12px; top: 0; animation-delay: 0s; }
.cd__spin span:nth-child(2) { left: 22px; top: 2px; animation-delay: 0.1s; }
.cd__spin span:nth-child(3) { left: 24px; top: 12px; animation-delay: 0.2s; }
.cd__spin span:nth-child(4) { left: 22px; top: 22px; animation-delay: 0.3s; }
.cd__spin span:nth-child(5) { left: 12px; top: 24px; animation-delay: 0.4s; }
.cd__spin span:nth-child(6) { left: 2px; top: 22px; animation-delay: 0.5s; }
.cd__spin span:nth-child(7) { left: 0; top: 12px; animation-delay: 0.6s; }
.cd__spin span:nth-child(8) { left: 2px; top: 2px; animation-delay: 0.7s; }
@keyframes cd-spin {
  0% { background: var(--gold); box-shadow: 0 0 8px var(--gold); }
  12.5% { background: color-mix(in srgb, var(--gold) 25%, var(--bg)); box-shadow: none; }
}
@media (prefers-reduced-motion: reduce) { .cd__spin span { animation: none; } }
</style>
