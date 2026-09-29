<template>
  <button
    v-if="fromTown"
    type="button"
    class="px-btn px-btn--dim"
    title="BACK TO THE TOWN [ESC]"
    aria-label="Back to the town on phareim.no"
    @click="leave"
  >⌂<span class="town__word"> TOWN</span></button>
</template>

<script setup lang="ts">
// Arrived from the town on phareim.no (its beach booth links here): a way back,
// in the deck's transport row after the thumbs (hidden with the deck in DIM).
// `?from=phareim` or a phareim.no referrer switches it on, and sessionStorage
// keeps it on across reloads. History-back when the town is the previous page,
// so the hero stands where they left; otherwise a plain link home.
const HOME = 'https://phareim.no/'
const KEY = 'radio.fromTown'
const fromTown = ref(false)

function remembered(): boolean {
  try { return sessionStorage.getItem(KEY) === '1' } catch { return false }
}
function cameFromTown(): boolean {
  if (new URLSearchParams(location.search).get('from') === 'phareim') return true
  try { return new URL(document.referrer).hostname === 'phareim.no' } catch { return false }
}

function leave() {
  if (document.referrer.startsWith(HOME) && history.length > 1) history.back()
  else location.href = HOME
}

// Escape leaves too, unless something else (a dialog) used it: checked after the whole dispatch.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.repeat) return
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
  setTimeout(() => { if (!e.defaultPrevented) leave() }, 0)
}

onMounted(() => {
  fromTown.value = remembered() || cameFromTown()
  if (!fromTown.value) return
  try { sessionStorage.setItem(KEY, '1') } catch { /* private window */ }
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* Phones: just the house, a square like the thumbs, so the transport row fits. */
@media (max-width: 700px) {
  .town__word { display: none; }
}
</style>
