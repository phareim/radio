import { haptic } from '~/composables/useHaptics'

/** Every enabled button ticks on tap (sliders tick themselves as they move). */
export default defineNuxtPlugin(() => {
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest('button')
    if (b && !b.disabled) haptic()
  }, true)
})
