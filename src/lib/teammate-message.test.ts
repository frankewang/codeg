import { describe, expect, it } from "vitest"

import {
  hasTeammateMessage,
  parseTeammateEnvelope,
  unescapeTeammateText,
} from "./teammate-message"

const RESULT = `<teammate-message teammate_id="d3-b2-validator" summary="M4-D3 B2 Validator: NEEDS_WORK, 9 major">
M4-D3 B2 Validator r1 完成，结论 **NEEDS_WORK**（9 项 admitted major，无 blocker）。未修改 Plan，仅新增评审记录。

Findings 摘要：
- V-1 major: T1 GREEN 要求安装器/使用说明入包。
</teammate-message>`

const NOTIFICATION = `<teammate-message teammate_id="system" summary="d3-b2-validator completed: D3 B2 Validator 独立评审">
[Framework Auto-Notification]
Teammate "d3-b2-validator" completed successfully.
Task: D3 B2 Validator 独立评审
Duration: 13m 17s
</teammate-message>`

describe("hasTeammateMessage", () => {
  it("detects the envelope and ignores ordinary prose", () => {
    expect(hasTeammateMessage(RESULT)).toBe(true)
    expect(hasTeammateMessage("plain assistant text")).toBe(false)
    // A quoted example in prose is not an envelope at position 0.
    expect(hasTeammateMessage("see `<teammate-message>` docs")).toBe(true)
  })
})

describe("parseTeammateEnvelope — result", () => {
  it("extracts id, summary and body, consuming the envelope", () => {
    const parsed = parseTeammateEnvelope(RESULT, 0, false)
    expect(parsed).not.toBeNull()
    expect(parsed!.message.kind).toBe("result")
    expect(parsed!.message.teammateId).toBe("d3-b2-validator")
    expect(parsed!.message.summary).toBe(
      "M4-D3 B2 Validator: NEEDS_WORK, 9 major"
    )
    expect(parsed!.message.body).toContain("**NEEDS_WORK**")
    expect(parsed!.message.body).toContain("Findings 摘要")
    expect(parsed!.message.body).not.toContain("</teammate-message>")
    expect(parsed!.end).toBe(RESULT.length)
    expect(parsed!.message.isStreaming).toBe(false)
  })

  it("keeps surrounding prose separate", () => {
    const text = `前言。\n\n${RESULT}\n\n后记。`
    const start = text.indexOf("<teammate-message")
    const parsed = parseTeammateEnvelope(text, start, false)
    expect(text.slice(0, start).trim()).toBe("前言。")
    expect(text.slice(parsed!.end).trim()).toBe("后记。")
  })

  it("decodes HTML entities in the summary", () => {
    const text = `<teammate-message teammate_id="x" summary="a &amp; b &lt;c&gt;">body</teammate-message>`
    const parsed = parseTeammateEnvelope(text, 0, false)
    expect(parsed!.message.summary).toBe("a & b <c>")
  })

  it("supports single-quoted attributes and multiline summary", () => {
    const text = `<teammate-message teammate_id='x' summary='line one
line two'>body</teammate-message>`
    const parsed = parseTeammateEnvelope(text, 0, false)
    expect(parsed!.message.summary).toBe("line one\nline two")
  })

  it("renders an unclosed envelope as a streaming card", () => {
    const text = `<teammate-message teammate_id="x" summary="WIP">partial body`
    const parsed = parseTeammateEnvelope(text, 0, true)
    expect(parsed!.message.isStreaming).toBe(true)
    expect(parsed!.message.body).toBe("partial body")
    expect(parsed!.end).toBe(text.length)
  })
})

describe("parseTeammateEnvelope — framework notification", () => {
  it("extracts member, status, task and duration", () => {
    const parsed = parseTeammateEnvelope(NOTIFICATION, 0, false)
    expect(parsed!.message.kind).toBe("notification")
    if (parsed!.message.kind !== "notification") return
    expect(parsed!.message.memberName).toBe("d3-b2-validator")
    expect(parsed!.message.status).toBe("completed")
    expect(parsed!.message.task).toBe("D3 B2 Validator 独立评审")
    expect(parsed!.message.duration).toBe("13m 17s")
    expect(parsed!.message.error).toBeNull()
  })

  it("recognises failure / cancellation / stop and the Error line", () => {
    const failed = `<teammate-message teammate_id="system" summary="x failed">
[Framework Auto-Notification]
Teammate "worker-1" failed.
Task: build
Duration: 2m 5s
Error: boom happened
</teammate-message>`
    const parsed = parseTeammateEnvelope(failed, 0, false)
    if (parsed!.message.kind !== "notification") return
    expect(parsed!.message.status).toBe("failed")
    expect(parsed!.message.memberName).toBe("worker-1")
    expect(parsed!.message.error).toBe("boom happened")
  })

  it("classifies by the [Framework Auto-Notification] marker even without teammate_id=system", () => {
    const text = `<teammate-message teammate_id="lead" summary="n">
[Framework Auto-Notification]
Background agent "bg" was cancelled.
Task: t
</teammate-message>`
    const parsed = parseTeammateEnvelope(text, 0, false)
    expect(parsed!.message.kind).toBe("notification")
    if (parsed!.message.kind !== "notification") return
    expect(parsed!.message.status).toBe("cancelled")
    expect(parsed!.message.memberName).toBe("bg")
  })

  it("returns null for a non-envelope start", () => {
    expect(parseTeammateEnvelope("plain text", 0, false)).toBeNull()
  })
})

describe("unescapeTeammateText", () => {
  it("decodes entities without double-unescaping", () => {
    expect(unescapeTeammateText("&amp;lt;")).toBe("&lt;")
    expect(unescapeTeammateText("&#39;")).toBe("'")
  })
})
