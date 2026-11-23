"use client"

import { useCallback, useEffect, useRef } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

interface UseTwoFingerContextMenuOptions {
  /** When false every gesture passes through untouched (Radix default). */
  enabled?: boolean
  /** How long both fingers must stay down before the menu opens. */
  longPressMs?: number
  /** A finger travelling further than this cancels the two-finger gesture. */
  moveThresholdPx?: number
}

interface TrackedPointer {
  startX: number
  startY: number
  x: number
  y: number
}

/**
 * Touch-friendly replacement for Radix ContextMenuTrigger's built-in
 * SINGLE-finger long-press, which otherwise fires while the user is trying to
 * select text — Radix then preventDefault()s the native Copy menu.
 *
 *   one finger  -> Radix never arms; the browser's native selection / Copy
 *                  menu is left alone.
 *   two fingers -> after `longPressMs` with both fingers still, dispatch a
 *                  synthetic `contextmenu` so Radix opens the very same menu
 *                  the desktop right-click opens.
 *
 * Spread the returned CAPTURE handlers onto the trigger's own element (the
 * child of `<ContextMenuTrigger asChild>`). Capture runs before Radix's
 * bubble-phase onPointerDown, so stopPropagation() on touch/pen
 * pointerdown keeps Radix's 700ms timer from ever arming, including on nested
 * triggers (cards, folder rows, the composer). Nothing is preventDefault()ed,
 * so taps, scrolling, pinch zoom and native text selection all keep working.
 *
 * Elements that genuinely need the raw pointerdown (drag grips, split-resize
 * handles) opt out with `data-native-long-press-menu`: their gestures pass
 * through unchanged, including Radix's original single-finger long-press.
 *
 * Mouse is never touched: desktop right-click keeps using Radix's own handler.
 */
export function useTwoFingerContextMenu({
  enabled = true,
  longPressMs = 550,
  moveThresholdPx = 12,
}: UseTwoFingerContextMenuOptions = {}) {
  const pointersRef = useRef(new Map<number, TrackedPointer>())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<{ target: Element; x: number; y: number } | null>(
    null
  )

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    clearTimer()
    pointersRef.current.clear()
    anchorRef.current = null
  }, [clearTimer])

  useEffect(() => reset, [reset])

  const fire = useCallback(() => {
    const anchor = anchorRef.current
    reset()
    if (!anchor || !anchor.target.isConnected) return
    // Prefer whatever is under the midpoint now (the innermost nested trigger
    // wins, exactly like a real right-click); fall back to the element the
    // second finger landed on. jsdom lacks elementFromPoint — hence the guard.
    let target: Element = anchor.target
    if (typeof document.elementFromPoint === "function") {
      try {
        target = document.elementFromPoint(anchor.x, anchor.y) ?? anchor.target
      } catch {
        target = anchor.target
      }
    }
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: anchor.x,
        clientY: anchor.y,
      })
    )
  }, [reset])

  const onPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType === "mouse") return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest("[data-native-long-press-menu]")) return

      // The crux: Radix must not see this pointerdown, or a single-finger
      // long-press would open the menu and kill native text selection.
      event.stopPropagation()

      pointersRef.current.set(event.pointerId, {
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
      })
      clearTimer()
      if (pointersRef.current.size === 2) {
        const [a, b] = Array.from(pointersRef.current.values())
        anchorRef.current = {
          target,
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        }
        timerRef.current = setTimeout(fire, longPressMs)
      } else if (pointersRef.current.size === 1) {
        anchorRef.current = { target, x: event.clientX, y: event.clientY }
      } else {
        // Three or more fingers: not our gesture.
        anchorRef.current = null
      }
    },
    [enabled, longPressMs, clearTimer, fire]
  )

  const onPointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const pointer = pointersRef.current.get(event.pointerId)
      if (!pointer) return
      pointer.x = event.clientX
      pointer.y = event.clientY
      const moved = Math.hypot(
        pointer.x - pointer.startX,
        pointer.y - pointer.startY
      )
      if (moved > moveThresholdPx) clearTimer()
    },
    [moveThresholdPx, clearTimer]
  )

  const releasePointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!pointersRef.current.delete(event.pointerId)) return
      // A lifted finger always cancels; a fresh second touchdown re-arms.
      clearTimer()
      if (pointersRef.current.size === 0) anchorRef.current = null
    },
    [clearTimer]
  )

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture: releasePointer,
    onPointerCancelCapture: releasePointer,
  }
}
