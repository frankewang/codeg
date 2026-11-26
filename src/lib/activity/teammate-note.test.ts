import { describe, expect, it } from "vitest"

import {
  adaptMessageTurn,
  type AdaptedContentPart,
} from "@/lib/adapters/ai-elements-adapter"
import type { MessageTurn } from "@/lib/types"
import { buildActivity } from "./build-activity"

const RESULT = `<teammate-message teammate_id="d3-b2-validator" summary="M4-D3 B2 Validator: NEEDS_WORK, 9 major">
结论 **NEEDS_WORK**。
</teammate-message>`

const NOTIFICATION = `<teammate-message teammate_id="system" summary="d3-b2-validator completed: D3 B2 Validator 独立评审">
[Framework Auto-Notification]
Teammate "d3-b2-validator" completed successfully.
Task: D3 B2 Validator 独立评审
Duration: 13m 17s
</teammate-message>`

function turn(role: "user" | "assistant", text: string): MessageTurn {
  return {
    id: "t",
    role,
    timestamp: "2026-11-26T06:00:00.000Z",
    blocks: [{ type: "text", text }],
  }
}

function activityOf(role: "user" | "assistant", text: string) {
  const adapted = adaptMessageTurn(
    turn(role, text),
    { attachedResources: "", toolCallFailed: "Tool call failed" },
    false
  )
  return buildActivity(adapted.content, { isStreaming: false }).items
}

describe("CodeBuddy teammate cards in the activity timeline", () => {
  // Regression guard: buildActivity has NO default branch, so a new part type
  // that is not handled there is silently dropped from assistant turns.
  it("keeps a teammate result as a note instead of dropping it", () => {
    const items = activityOf("assistant", RESULT)
    const notes = items.flatMap((item) =>
      item.type === "group" ? [] : [item.step]
    )
    expect(
      notes.some(
        (step) => step.type === "note" && step.part.type === "teammate-message"
      )
    ).toBe(true)
  })

  it("keeps both envelopes of a two-reviewer round", () => {
    const items = activityOf("user", `${RESULT}\n\n${NOTIFICATION}`)
    const parts: AdaptedContentPart[] = []
    for (const item of items) {
      if (item.type === "group") continue
      if (item.step.type === "note") parts.push(item.step.part)
    }
    expect(parts.filter((p) => p.type === "teammate-message")).toHaveLength(2)
  })

  it("does not produce a teammate note for ordinary prose", () => {
    const adapted = adaptMessageTurn(
      turn("assistant", "just a normal reply"),
      { attachedResources: "", toolCallFailed: "Tool call failed" },
      false
    )
    const model = buildActivity(adapted.content, {
      isStreaming: false,
      keepAnswer: true,
    })
    const notes = model.items.flatMap((item) =>
      item.type === "group" ? [] : item.step.type === "note" ? [item.step] : []
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]!.part.type).toBe("text")
    expect(notes.some((n) => n.part.type === "teammate-message")).toBe(false)
  })
})
