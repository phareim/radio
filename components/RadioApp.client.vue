<template>
  <div class="app" :class="{ 'app--narrow': narrow }">
    <SceneWindow class="app__win" @start="toggle" />
    <LayerStrip class="app__strip" />

    <div class="app__deck">
      <div class="deck__transport">
        <button
          type="button"
          class="px-btn px-btn--pink deck__play"
          :class="{ on: playing }"
          :aria-label="playing ? 'Pause' : 'Play'"
          title="PLAY / PAUSE [SPACE]"
          @click="toggle"
        >{{ playing ? '❚❚ PAUSE' : '▶ PLAY' }}</button>
        <button type="button" class="px-btn deck__thumb" title="I LIKE THIS [+]" aria-label="Thumbs up" @click="rate(1)">▲</button>
        <button type="button" class="px-btn px-btn--pink deck__thumb" title="NOT THIS [-]" aria-label="Thumbs down" @click="rate(-1)">▼</button>
        <button type="button" class="px-btn px-btn--dim deck__note" title="A NOTE ON THIS MOMENT" @click="rate(0)">NOTE</button>
        <button
          type="button"
          class="px-btn px-btn--gold deck__hold"
          :class="{ on: controls.hold }"
          :aria-pressed="controls.hold"
          title="KEEP THIS PROGRESSION AND MOTIF LOOPING [H]"
          @click="set({ hold: !controls.hold })"
        >HOLD</button>
      </div>

      <StationDial class="deck__dial" @compose="composeOpen = true" />

      <div class="deck__knobs">
        <IntensityBar />
        <PxSlider :model-value="controls.mood" label="MOOD" left="BRIGHT" right="DARK" :compact="narrow" color="#cfc6ff" @update:model-value="set({ mood: $event })" />
        <PxSlider :model-value="controls.space" label="SPACE" left="DRY" right="VAST" :compact="narrow" @update:model-value="set({ space: $event })" />
        <PxSlider :model-value="controls.grit" label="GRIT" left="CLEAN" right="TAPE" :compact="narrow" color="#ff8a3d" @update:model-value="set({ grit: $event })" />
        <PxSlider :model-value="controls.density" label="DENSITY" left="SPARSE" right="BUSY" :compact="narrow" color="#3fe0a0" @update:model-value="set({ density: $event })" />
        <PxSlider
          :model-value="controls.tempo"
          label="TEMPO"
          :min="-20"
          :max="20"
          :step="2"
          :segments="20"
          bipolar
          :left="narrow ? '' : '-20'"
          :right="narrow ? '' : '+20'"
          :compact="narrow"
          color="#ffd23f"
          :format="(v: number) => (v > 0 ? `+${v}` : `${v}`)"
          @update:model-value="set({ tempo: $event })"
        />
        <div class="deck__vol">
          <PxSlider
            :model-value="muted ? 0 : volume"
            label="VOLUME"
            :step="0.05"
            :segments="10"
            color="#ff2fa0"
            compact
            @update:model-value="setVolume($event)"
          />
          <button
            type="button"
            class="deck__mute"
            :class="{ on: muted }"
            :aria-label="muted ? 'Unmute' : 'Mute'"
            title="MUTE [M]"
            @click="toggleMute"
          >{{ muted ? '×' : '♪' }}</button>
        </div>
      </div>
    </div>

    <CommentBox />
    <ComposeDialog v-if="composeOpen" @close="composeOpen = false" />
    <p v-if="toast" :key="toast.n" class="app__toast px-box" :class="{ warn: toast.tone === 'warn' }" role="status">{{ toast.text }}</p>
    <p v-if="composing && !composeOpen" class="app__working" @click="composeOpen = true">
      <span class="px-blink">◈ OPUS IS COMPOSING...</span>
    </p>
    <!-- The master output, so iOS keeps playing with the screen locked. -->
    <audio ref="audioEl" class="app__audio" playsinline aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
/**
 * The whole radio page, client-only. Owns the keyboard, the media session
 * and the hidden <audio> element; the parts own their own drawing.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Controls } from '~/engine/types.ts'

const radio = useRadio()
const { controls, playing, volume, muted, set, setVolume, toggleMute, landscapes, landscapeOf, hud } = radio
const { rate, toast, say, flush } = useFeedback()
const { compose, refresh, resume } = usePlaces()

const composeOpen = ref(false)
const composing = computed(() => compose.value.phase === 'working')
const narrow = ref(false)
const audioEl = ref<HTMLAudioElement | null>(null)

// When a compose lands while the box is closed, open it to offer the trip.
watch(() => compose.value.phase, (p) => { if (p === 'done') composeOpen.value = true })

// ---- play / pause ------------------------------------------------------------

let pauseTimer: ReturnType<typeof setTimeout> | null = null

function toggle(): void {
  if (playing.value) {
    radio.pause()
    // The player fades out over a second; the element carries that fade when it is the output.
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = setTimeout(() => { if (!playing.value) audioEl.value?.pause() }, 1200)
    setSessionState()
    return
  }
  if (!radio.hasPlayer) {
    say('NO AUDIO ENGINE YET', 'warn')
    return
  }
  if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null }
  const started = radio.play()
  // The player builds its context and stream synchronously, so the element
  // starts inside this same gesture.
  routeToElement()
  setSessionState()
  started.catch(() => say('AUDIO WOULD NOT START', 'warn'))
}

/**
 * Play the master stream through the hidden <audio> element, so the OS
 * treats the page as a media player (lock screen, media keys, background
 * playback). Only where the AudioContext's own output can be silenced
 * (setSinkId 'none', Chromium): elsewhere the element would double the music,
 * so the context plays straight to the speakers.
 */
let routed = false
function routeToElement(): void {
  const el = audioEl.value
  const stream = radio.stream()
  const ac = radio.context() as (AudioContext & { setSinkId?: (id: string | { type: 'none' }) => Promise<void> }) | null
  if (!el || !stream || !ac) return
  if (routed) { el.play().catch(() => {}); return }
  if (typeof ac.setSinkId !== 'function') return
  if (el.srcObject !== stream) el.srcObject = stream
  el.play()
    .then(() => ac.setSinkId!({ type: 'none' }))
    .then(() => { routed = true })
    .catch(() => { el.pause(); el.srcObject = null })
}

// ---- media session -------------------------------------------------------------

function setSessionState(): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = playing.value ? 'playing' : 'paused'
}

function setMetadata(): void {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
  const L = landscapeOf(hud.landscape)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: L.name,
    artist: 'radio.phareim.no',
    album: radio.intensityNames[controls.intensity],
    artwork: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
}

function stepPlace(d: number): void {
  const list = landscapes.value
  const i = list.findIndex(l => l.id === controls.landscape)
  set({ landscape: list[(i + d + list.length) % list.length]!.id })
}

function wireMediaSession(): void {
  if (!('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  const on = (a: MediaSessionAction, h: MediaSessionActionHandler) => { try { ms.setActionHandler(a, h) } catch { /* unsupported */ } }
  on('play', () => { if (!playing.value) toggle() })
  on('pause', () => { if (playing.value) toggle() })
  on('stop', () => { if (playing.value) toggle() })
  on('nexttrack', () => stepPlace(1))
  on('previoustrack', () => stepPlace(-1))
  setMetadata()
}

watch(() => [hud.landscape, controls.intensity, landscapes.value.length], setMetadata)

// ---- keyboard ------------------------------------------------------------------

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

function onKey(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
  if (e.key === 'Escape') {
    if (composeOpen.value) { composeOpen.value = false; e.preventDefault() }
    return
  }
  if (composeOpen.value) return
  const k = e.key
  let handled = true
  if (k === ' ' || e.code === 'Space') { if (!e.repeat) toggle() }
  else if (/^[0-9]$/.test(k)) {
    const L = landscapes.value[k === '0' ? 9 : Number(k) - 1]
    if (L) set({ landscape: L.id })
  }
  else if (k === 'ArrowLeft') stepPlace(-1)
  else if (k === 'ArrowRight') stepPlace(1)
  else if (k === 'ArrowUp') set({ intensity: Math.min(4, controls.intensity + 1) as Controls['intensity'] })
  else if (k === 'ArrowDown') set({ intensity: Math.max(0, controls.intensity - 1) as Controls['intensity'] })
  else if (k === 'h' || k === 'H') set({ hold: !controls.hold })
  else if (k === '+' || k === '=' || e.code === 'NumpadAdd') { if (!e.repeat) void rate(1) }
  else if (k === '-' || k === '_' || e.code === 'NumpadSubtract') { if (!e.repeat) void rate(-1) }
  else if (k === 'm' || k === 'M') { if (!e.repeat) toggleMute() }
  else if (k === 'n' || k === 'N') { if (!e.repeat) void rate(0) }
  else handled = false
  if (handled) e.preventDefault()
}

// ---- layout --------------------------------------------------------------------

let mq: MediaQueryList | null = null
const onMq = () => { narrow.value = !!mq?.matches }

onMounted(() => {
  if (import.meta.dev) (window as unknown as Record<string, unknown>).__radioDev = { radio, places: usePlaces(), feedback: useFeedback() }
  mq = window.matchMedia('(max-width: 700px)')
  onMq()
  mq.addEventListener('change', onMq)
  window.addEventListener('keydown', onKey)
  wireMediaSession()
  void refresh()
  resume()
  void flush()
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMq)
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.app {
  position: relative;
  height: var(--app-height);
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  overflow: hidden;
  background: var(--bg);
  font-size: 16px;
  line-height: 20px;
  text-transform: uppercase;
  --pxs-label-w: 96px;
}

.app__win { min-height: 0; }

.app__deck {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  grid-template-areas:
    "transport knobs"
    "dial knobs";
  grid-template-rows: auto 1fr;
  gap: 16px 40px;
  padding: 16px 24px calc(16px + var(--app-safe-bottom));
  background: var(--bg);
}

.deck__transport { grid-area: transport; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 2px; }
.deck__dial { grid-area: dial; }
.deck__knobs { grid-area: knobs; display: flex; flex-direction: column; gap: 8px; justify-content: center; }

.deck__play { min-width: 128px; height: 36px; padding: 0 14px; }
.deck__play.on, .deck__play.on:hover { color: var(--bg); background: var(--pink); box-shadow: 0 -2px 0 0 var(--pink), 0 2px 0 0 var(--pink), -2px 0 0 0 var(--pink), 2px 0 0 0 var(--pink), 0 0 14px color-mix(in srgb, var(--pink) 55%, transparent); }
.deck__thumb { width: 40px; height: 36px; padding: 0; }
.deck__note { height: 36px; }
.deck__hold { height: 36px; margin-left: auto; }
.deck__hold.on, .deck__hold.on:hover { color: var(--bg); background: var(--gold); }

.deck__vol { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; }
.deck__mute {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pink);
  font-size: 16px;
  cursor: pointer;
}
.deck__mute.on { color: var(--subtle); }

.app__toast {
  --px-edge: var(--cyan);
  position: absolute;
  z-index: 25;
  left: 50%;
  top: 20%;
  transform: translate(-50%, -50%);
  margin: 0;
  padding: 10px 16px;
  white-space: nowrap;
  background: var(--bg);
  color: var(--cyan);
  text-shadow: 2px 2px 0 var(--bg);
  pointer-events: none;
  animation: toast-in 0.12s steps(2);
}
.app__toast.warn { --px-edge: var(--gold); color: var(--gold); }
@keyframes toast-in { from { opacity: 0; } }

.app__working {
  position: absolute;
  z-index: 5;
  left: 16px;
  top: calc(84px + env(safe-area-inset-top, 0px));
  margin: 0;
  color: var(--gold);
  text-shadow: 2px 2px 0 var(--bg);
  cursor: pointer;
}

.app__audio { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

/* Short desktop windows: tighter deck. */
@media (min-width: 701px) and (max-height: 760px) {
  .app__deck { padding-top: 12px; gap: 12px 32px; }
  .deck__knobs { gap: 4px; }
}

/* Phones: the window on top, the deck stacked under it. */
@media (max-width: 700px) {
  .app { --pxs-label-w: 88px; }
  .app__deck {
    grid-template-columns: 1fr;
    grid-template-areas: "transport" "dial" "knobs";
    grid-template-rows: auto auto auto;
    gap: 12px;
    padding: 12px 16px calc(12px + var(--app-safe-bottom));
  }
  .deck__transport { gap: 10px; flex-wrap: nowrap; }
  .deck__play { min-width: 0; flex: 1; padding: 0 8px; }
  .deck__thumb { width: 40px; flex: none; }
  .deck__note, .deck__hold { flex: none; padding: 0 8px; margin: 0; }
  .deck__knobs { gap: 4px; }
  .app__working { top: calc(72px + env(safe-area-inset-top, 0px)); }
}
</style>
