/**
 * A light tick on iPhone. Safari has no Vibration API, but since iOS 17.4 it
 * ticks when a `<input type="checkbox" switch>` is toggled, so we keep one
 * hidden and click its label. Elsewhere this does nothing. iOS only ticks
 * inside a user gesture, so call it from a tap or a drag, never a timer.
 */
let label: HTMLLabelElement | null = null

function build(): HTMLLabelElement | null {
  const ios = /iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))
  if (!ios) return null
  const probe = document.createElement('input')
  probe.type = 'checkbox'
  probe.setAttribute('switch', '')
  const el = document.createElement('label')
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden'
  el.appendChild(probe)
  document.body.appendChild(el)
  return el
}

export function haptic(): void {
  if (typeof document === 'undefined') return
  if (label === null) label = build()
  label?.click()
}
