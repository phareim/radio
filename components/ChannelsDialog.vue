<template>
  <div class="ch__veil" @click.self="$emit('close')">
    <div class="ch px-box" role="dialog" aria-label="Channels">
      <p class="ch__title">CHANNELS</p>
      <p class="ch__sub">
        WHAT SHOWS ON THE DIAL · {{ allowed ? 'KEPT FOR ALL YOUR DEVICES' : 'KEPT IN THIS BROWSER' }}
      </p>

      <ul class="ch__list">
        <li v-for="L in landscapes" :key="L.id" class="ch__item" :style="{ '--st': L.accent || '#2ff3ff' }">
          <button
            type="button"
            class="ch__toggle"
            :class="{ off: isHidden(L.id), playing: L.id === hud.landscape }"
            role="switch"
            :aria-checked="!isHidden(L.id)"
            :title="isHidden(L.id) ? 'SHOW ON THE DIAL' : 'HIDE FROM THE DIAL'"
            @click="toggle(L.id)"
          >
            <span class="ch__box" aria-hidden="true">{{ isHidden(L.id) ? '' : '■' }}</span>
            <span class="ch__name">{{ L.origin === 'opus' ? '◈ ' : '' }}{{ L.name }}</span>
            <span class="ch__blurb">{{ L.origin === 'opus' ? 'YOURS · ' : '' }}{{ L.blurb }}</span>
          </button>
          <button
            v-if="allowed && L.origin === 'opus'"
            type="button"
            class="ch__remove"
            :class="{ sure: confirmId === L.id }"
            :title="`REMOVE ${L.name.toUpperCase()} FOR GOOD`"
            @click="remove(L.id)"
          >{{ confirmId === L.id ? 'SURE? ×' : '×' }}</button>
        </li>
      </ul>

      <div class="ch__row">
        <button v-if="allowed" type="button" class="px-btn px-btn--gold" @click="$emit('compose')">+ NEW PLACE</button>
        <button type="button" class="px-btn px-btn--dim ch__done" @click="$emit('close')">DONE</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Channel admin: every channel with a switch for whether it shows on the
 * dial, your own composed ones (◈) with a remove, and + NEW PLACE for
 * members. Visibility is kept by useChannels (per browser, or per member on
 * every device).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ close: []; compose: [] }>()

const { landscapes, hud } = useRadio()
const { isHidden, setShown } = useChannels()
const { allowed } = useAuth()
const { hide } = usePlaces()
const { say } = useFeedback()

const confirmId = ref('')

function toggle(id: string): void {
  confirmId.value = ''
  if (!setShown(id, isHidden(id))) say('ONE CHANNEL HAS TO STAY', 'warn')
}

async function remove(id: string): Promise<void> {
  if (confirmId.value !== id) { confirmId.value = id; return }
  confirmId.value = ''
  const ok = await hide(id)
  say(ok ? 'REMOVED' : 'COULD NOT REMOVE', ok ? 'ok' : 'warn')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); emit('close') }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<style scoped>
.ch__veil {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(11, 6, 22, 0.6);
}

.ch {
  width: min(640px, 100%);
  max-height: calc(var(--app-height, 100dvh) - 32px);
  display: flex;
  flex-direction: column;
  padding: 16px 16px 14px;
  background: var(--bg);
  font-size: 16px;
  line-height: 20px;
  color: var(--ink);
  text-transform: uppercase;
}
.ch p { margin: 0; }

.ch__title { color: var(--cyan); text-shadow: 2px 2px 0 var(--bg); }
.ch__sub { color: var(--subtle); margin: 4px 0 12px !important; }

.ch__list {
  list-style: none;
  margin: 0;
  padding: 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
  overscroll-behavior: contain;
}

.ch__item { display: flex; align-items: stretch; gap: 8px; }

.ch__toggle {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 20px auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--st) 55%, transparent);
  color: var(--st);
  font: inherit;
  text-transform: inherit;
  text-align: left;
  cursor: pointer;
}
.ch__toggle:hover, .ch__toggle:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--st); }
.ch__toggle.playing .ch__name { text-shadow: 0 0 10px color-mix(in srgb, var(--st) 60%, transparent); }
.ch__toggle.off { color: var(--subtle); box-shadow: inset 0 0 0 2px #2a2050; }
.ch__toggle.off:hover { box-shadow: inset 0 0 0 2px var(--muted); }

.ch__box {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  box-shadow: inset 0 0 0 2px currentColor;
  font-size: 16px;
  line-height: 1;
}
.ch__name { white-space: nowrap; }
.ch__blurb { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch__toggle.off .ch__blurb { color: #3a2f66; }

.ch__remove {
  flex: none;
  min-width: 40px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  box-shadow: inset 0 0 0 2px #4a3d88;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}
.ch__remove:hover, .ch__remove.sure { color: var(--pink); box-shadow: inset 0 0 0 2px var(--pink); }

.ch__row { display: flex; justify-content: flex-end; gap: 12px; margin-top: 14px; }

@media (max-width: 700px) {
  .ch__veil { place-items: start center; padding-top: calc(12px + env(safe-area-inset-top, 0px)); }
  .ch__toggle { grid-template-columns: 20px minmax(0, 1fr); }
  .ch__blurb { display: none; }
  .ch__name { overflow: hidden; text-overflow: ellipsis; }
}
</style>
