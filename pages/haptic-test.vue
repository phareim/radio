<template>
  <main class="ht">
    <h1>HAPTIC TEST</h1>
    <p>{{ ua }}</p>
    <p>Tap each one. Say which ones tick.</p>

    <div class="ht__row">
      <label class="ht__btn">
        <input type="checkbox" switch class="ht__real">
        A. VISIBLE SWITCH (control)
      </label>
    </div>

    <div class="ht__row">
      <button type="button" class="ht__btn" @click="n.b++">
        B. OVERLAY SWITCH IN BUTTON ({{ n.b }})
        <input type="checkbox" switch class="ht__overlay">
      </button>
    </div>

    <div class="ht__row">
      <div class="ht__btn" @click="n.c++">
        C. OVERLAY SWITCH IN DIV ({{ n.c }})
        <input type="checkbox" switch class="ht__overlay">
      </div>
    </div>

    <div class="ht__row">
      <button type="button" class="ht__btn" @click="script(); n.d++">D. LABEL.CLICK() FROM SCRIPT ({{ n.d }})</button>
      <label ref="lab" class="ht__hidden"><input type="checkbox" switch></label>
    </div>
  </main>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'

useHead({ title: 'Haptic test' })
const ua = import.meta.client ? navigator.userAgent : ''
const n = reactive({ b: 0, c: 0, d: 0 })
const lab = ref<HTMLLabelElement | null>(null)
function script(): void {
  lab.value?.click()
}
</script>

<style scoped>
.ht { padding: 24px 16px; font-family: var(--font-pixel, monospace); color: var(--ink, #fff); }
.ht__row { margin: 16px 0; }
.ht__btn {
  position: relative;
  display: block;
  width: 100%;
  padding: 18px 12px;
  border: 2px solid currentColor;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
.ht__real { margin-right: 12px; }
.ht__overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
}
.ht__hidden { position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; overflow: hidden; pointer-events: none; }
</style>
