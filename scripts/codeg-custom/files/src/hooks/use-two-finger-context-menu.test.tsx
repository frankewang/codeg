import { act, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useTwoFingerContextMenu } from "./use-two-finger-context-menu"

/**
 * The inner div stands in for Radix's ContextMenuTrigger: `onPointerDown` is
 * where Radix arms its single-finger 700ms long-press, `onContextMenu` is what
 * opens the menu. Our wrapper must keep the first from firing on touch and
 * synthesize the second only for a two-finger hold.
 */
function Harness({
  onInnerPointerDown,
  onInnerContextMenu,
  nativeLongPress = false,
}: {
  onInnerPointerDown: () => void
  onInnerContextMenu: (e: React.MouseEvent) => void
  nativeLongPress?: boolean
}) {
  const handlers = useTwoFingerContextMenu({ longPressMs: 550 })
  // Same element as the "Radix" handlers, exactly like production where the
  // capture handlers sit on ContextMenuTrigger's own child.
  return (
    <div
      data-testid="trigger"
      {...handlers}
      data-native-long-press-menu={nativeLongPress || undefined}
      onPointerDown={onInnerPointerDown}
      onContextMenu={onInnerContextMenu}
    >
      <span data-testid="text">selectable conversation text</span>
    </div>
  )
}

function pointer(
  el: Element,
  type: string,
  init: {
    pointerId: number
    pointerType?: string
    clientX?: number
    clientY?: number
  }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType ?? "touch" },
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
  })
  fireEvent(el, event)
}

const down = (el: Element, id: number, x = 0, y = 0, pointerType = "touch") =>
  pointer(el, "pointerdown", {
    pointerId: id,
    clientX: x,
    clientY: y,
    pointerType,
  })
const move = (el: Element, id: number, x: number, y: number) =>
  pointer(el, "pointermove", { pointerId: id, clientX: x, clientY: y })
const up = (el: Element, id: number) =>
  pointer(el, "pointerup", { pointerId: id })

describe("useTwoFingerContextMenu", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(nativeLongPress = false) {
    const innerPointerDown = vi.fn()
    const innerContextMenu = vi.fn()
    const utils = render(
      <Harness
        onInnerPointerDown={innerPointerDown}
        onInnerContextMenu={innerContextMenu}
        nativeLongPress={nativeLongPress}
      />
    )
    return { ...utils, innerPointerDown, innerContextMenu }
  }

  it("single-finger long-press never reaches Radix and opens no menu", () => {
    const { getByTestId, innerPointerDown, innerContextMenu } = setup()
    const text = getByTestId("text")
    down(text, 1, 40, 60)
    expect(innerPointerDown).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(innerContextMenu).not.toHaveBeenCalled()
  })

  it("two-finger hold synthesizes one contextmenu at the midpoint", () => {
    const { getByTestId, innerPointerDown, innerContextMenu } = setup()
    const text = getByTestId("text")
    down(text, 1, 40, 60)
    down(text, 2, 80, 100)
    expect(innerPointerDown).not.toHaveBeenCalled()
    vi.advanceTimersByTime(549)
    expect(innerContextMenu).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(innerContextMenu).toHaveBeenCalledTimes(1)
    const event = innerContextMenu.mock.calls[0][0]
    // React synthetic MouseEvent exposes the native coordinates.
    expect(event.clientX).toBe(60)
    expect(event.clientY).toBe(80)
  })

  it("cancels when a finger lifts before the delay", () => {
    const { getByTestId, innerContextMenu } = setup()
    const text = getByTestId("text")
    down(text, 1)
    down(text, 2)
    vi.advanceTimersByTime(300)
    up(text, 2)
    vi.advanceTimersByTime(1000)
    expect(innerContextMenu).not.toHaveBeenCalled()
  })

  it("cancels when a finger moves beyond the threshold", () => {
    const { getByTestId, innerContextMenu } = setup()
    const text = getByTestId("text")
    down(text, 1, 0, 0)
    down(text, 2, 20, 0)
    vi.advanceTimersByTime(200)
    move(text, 2, 60, 0) // 40px > 12px threshold
    vi.advanceTimersByTime(1000)
    expect(innerContextMenu).not.toHaveBeenCalled()
  })

  it("tolerates small finger jitter", () => {
    const { getByTestId, innerContextMenu } = setup()
    const text = getByTestId("text")
    down(text, 1, 0, 0)
    down(text, 2, 20, 0)
    move(text, 2, 24, 3) // 5px < threshold
    vi.advanceTimersByTime(600)
    expect(innerContextMenu).toHaveBeenCalledTimes(1)
  })

  it("three fingers are not a menu gesture", () => {
    const { getByTestId, innerContextMenu } = setup()
    const text = getByTestId("text")
    down(text, 1)
    down(text, 2)
    down(text, 3)
    vi.advanceTimersByTime(1000)
    expect(innerContextMenu).not.toHaveBeenCalled()
  })

  it("mouse pointerdown passes through (desktop unchanged)", () => {
    const { getByTestId, innerPointerDown, innerContextMenu } = setup()
    down(getByTestId("text"), 1, 0, 0, "mouse")
    expect(innerPointerDown).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(innerContextMenu).not.toHaveBeenCalled()
  })

  it("data-native-long-press-menu rows keep the original behaviour", () => {
    const { getByTestId, innerPointerDown } = setup(true)
    down(getByTestId("text"), 1)
    expect(innerPointerDown).toHaveBeenCalledTimes(1)
  })
})

// Integration with the REAL Radix trigger — the unit tests above use a mock
// inner handler; these prove capture-phase stopPropagation actually beats
// Radix's own 700ms timer, and that an UNtrusted synthetic MouseEvent is
// accepted by Radix (some libraries ignore isTrusted=false; Radix does not).
describe("useTwoFingerContextMenu + real Radix ContextMenu", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function RadixHarness() {
    const handlers = useTwoFingerContextMenu({ longPressMs: 550 })
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div {...handlers}>
            <span data-testid="radix-text">message text</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Copy selection</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  it("single-finger hold no longer opens Radix's menu", () => {
    const { getByTestId, queryByText } = render(<RadixHarness />)
    down(getByTestId("radix-text"), 1)
    act(() => {
      vi.advanceTimersByTime(1500) // beyond Radix's own 700ms timer
    })
    expect(queryByText("Copy selection")).toBeNull()
  })

  it("two-finger hold opens the real Radix menu", () => {
    const { getByTestId, queryByText } = render(<RadixHarness />)
    const text = getByTestId("radix-text")
    down(text, 1, 10, 10)
    down(text, 2, 30, 30)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(queryByText("Copy selection")).not.toBeNull()
  })
})
