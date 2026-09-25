<template>
  <ClientOnly>
    <RadioApp />
    <template #fallback>
      <div class="shell">
        <p class="shell__title">RADIO</p>
        <p class="shell__sub px-blink">TUNING IN...</p>
      </div>
    </template>
  </ClientOnly>
</template>

<script setup lang="ts">
// The music, the scene and every control run in the browser; the Worker
// serves this shell and the /api proxies.
useHead({ title: 'Radio' })
</script>

<style scoped>
.shell {
  height: var(--app-height);
  display: grid;
  place-content: center;
  gap: 16px;
  text-align: center;
}
.shell p { margin: 0; }
.shell__title {
  font-size: 48px;
  line-height: 48px;
  color: var(--pink);
  text-shadow: 6px 6px 0 var(--bg), 0 0 24px color-mix(in srgb, var(--pink) 60%, transparent);
}
.shell__sub { font-size: 16px; color: var(--cyan); text-shadow: 2px 2px 0 var(--bg); }
</style>
