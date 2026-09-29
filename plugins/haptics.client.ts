/**
 * Taps tick on iPhone. Safari has no Vibration API. It ticks when a finger
 * toggles a native `<input type="checkbox" switch>`, and since iOS 26.5 that
 * has to be a real touch: script clicks (`label.click()`) no longer tick. So
 * every enabled button and slider track gets an invisible switch stretched
 * over it; the tap toggles the switch and bubbles to the element's own
 * handlers. Drags cannot tick (the touch stays on the first element), so a
 * slider ticks on tap only. The switch must keep its native look: hidden with
 * opacity, never display:none or appearance:none. Checked on iOS 26 by hand
 * with /haptic-test (2026-09-29).
 */
const TARGETS = 'button:not(:disabled), [role="slider"]'
const MARK = 'data-haptic'

function ios(): boolean {
  return /iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))
}

function overlay(): HTMLInputElement {
  const el = document.createElement('input')
  el.type = 'checkbox'
  el.setAttribute('switch', '')
  el.setAttribute(MARK, '')
  el.setAttribute('aria-hidden', 'true')
  el.tabIndex = -1
  el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;z-index:1'
  return el
}

function decorate(root: ParentNode): void {
  for (const t of root.querySelectorAll<HTMLElement>(TARGETS)) {
    if (t.querySelector(`:scope > [${MARK}]`)) continue
    if (getComputedStyle(t).position === 'static') t.style.position = 'relative'
    t.appendChild(overlay())
  }
  // A button that became disabled keeps no overlay: it must not tick.
  for (const o of root.querySelectorAll<HTMLElement>(`button:disabled > [${MARK}]`)) o.remove()
}

export default defineNuxtPlugin(() => {
  if (!ios()) return
  let queued = false
  const scan = (): void => {
    queued = false
    decorate(document)
  }
  // Vue re-renders can wipe a button's children, and buttons come and go, so
  // rescan (batched) on any change.
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(scan)
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] })
  scan()
})
