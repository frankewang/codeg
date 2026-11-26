import { describe, expect, it } from "vitest"

import {
  adaptMessageTurn,
  type AdaptedContentPart,
} from "./ai-elements-adapter"
import type { MessageTurn } from "@/lib/types"

const TEXT = { attachedResources: "", toolCallFailed: "Tool call failed" }

const RESULT = `<teammate-message teammate_id="d3-b2-validator" summary="M4-D3 B2 Validator: NEEDS_WORK, 9 major">
M4-D3 B2 Validator r1 完成，结论 **NEEDS_WORK**。

Findings 摘要：
- V-1 major: DAG 反向依赖
</teammate-message>`

const NOTIFICATION = `<teammate-message teammate_id="system" summary="d3-b2-validator completed: D3 B2 Validator 独立评审">
[Framework Auto-Notification]
Teammate "d3-b2-validator" completed successfully.
Task: D3 B2 Validator 独立评审
Duration: 13m 17s
</teammate-message>`

function turn(role: "user" | "assistant", blocks: string[]): MessageTurn {
  return {
    id: `turn-${role}-${blocks.length}`,
    role,
    timestamp: "2026-11-26T06:00:00.000Z",
    blocks: blocks.map((text) => ({ type: "text" as const, text })),
  }
}

function teammateParts(parts: AdaptedContentPart[]) {
  return parts.filter((p) => p.type === "teammate-message")
}

describe("CodeBuddy teammate messages in the adapter", () => {
  it("lifts a result out of a USER text block (the real framework shape)", () => {
    const adapted = adaptMessageTurn(turn("user", [RESULT]), TEXT, false)
    expect(teammateParts(adapted.content)).toHaveLength(1)
    const part = teammateParts(adapted.content)[0]
    if (part.type !== "teammate-message") return
    expect(part.message.kind).toBe("result")
    expect(part.message.teammateId).toBe("d3-b2-validator")
    expect(part.message.summary).toContain("NEEDS_WORK")
    // No raw XML leaks into any text part.
    expect(
      adapted.content.some(
        (p) => p.type === "text" && p.text.includes("<teammate-message")
      )
    ).toBe(false)
  })

  it("lifts the framework notification and parses its status", () => {
    const adapted = adaptMessageTurn(
      turn("assistant", [NOTIFICATION]),
      TEXT,
      false
    )
    const part = teammateParts(adapted.content)[0]
    if (part?.type !== "teammate-message") return
    expect(part.message.kind).toBe("notification")
    if (part.message.kind !== "notification") return
    expect(part.message.memberName).toBe("d3-b2-validator")
    expect(part.message.status).toBe("completed")
    expect(part.message.duration).toBe("13m 17s")
  })

  it("keeps surrounding prose as separate text parts", () => {
    const text = `评审已返回。\n\n${RESULT}\n\n等待 Challenger。`
    const adapted = adaptMessageTurn(turn("user", [text]), TEXT, false)
    const texts = adapted.content
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
    expect(texts).toContain("评审已返回。")
    expect(texts).toContain("等待 Challenger。")
    expect(teammateParts(adapted.content)).toHaveLength(1)
  })

  it("does not touch ordinary prose (including a quoted tag)", () => {
    const prose =
      "The docs mention <teammate-message> as a tag but it is not an envelope."
    const adapted = adaptMessageTurn(turn("user", [prose]), TEXT, false)
    expect(teammateParts(adapted.content)).toHaveLength(0)
    expect(adapted.content).toEqual([{ type: "text", text: prose }])
  })

  it("lifts both envelopes of a two-reviewer round in order", () => {
    const combined = `${RESULT}\n\n${NOTIFICATION}`
    const adapted = adaptMessageTurn(turn("user", [combined]), TEXT, false)
    const kinds = teammateParts(adapted.content).map((p) =>
      p.type === "teammate-message" ? p.message.kind : null
    )
    expect(kinds).toEqual(["result", "notification"])
  })

  it("renders an unclosed envelope as one streaming card", () => {
    const text = `<teammate-message teammate_id="x" summary="WIP">partial`
    const adapted = adaptMessageTurn(turn("user", [text]), TEXT, true)
    const part = teammateParts(adapted.content)[0]
    if (part?.type !== "teammate-message") return
    expect(part.message.isStreaming).toBe(true)
    expect(part.message.body).toBe("partial")
  })
})
