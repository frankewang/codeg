/**
 * Parser for CodeBuddy's teammate (sub-agent) messages.
 *
 * CodeBuddy's team framework injects a sub-agent's result into the lead's
 * conversation as plain text inside an XML-ish envelope, rather than as an
 * ACP tool call / tool result. Without this parser it renders as a long raw
 * text block with visible `<teammate-message>` tags.
 *
 * Two shapes are emitted (see `buildTeamMemberNotification` in CodeBuddy):
 *
 *   result:
 *     <teammate-message teammate_id="d3-b2-validator" summary="M4-D3 B2
 *     Validator: NEEDS_WORK, 9 major">
 *     M4-D3 B2 Validator r1 完成，结论 **NEEDS_WORK** …
 *     Findings 摘要：…
 *     </teammate-message>
 *
 *   notification (system, on terminal status):
 *     <teammate-message teammate_id="system" summary="d3-b2-validator
 *     completed: D3 B2 Validator 独立评审">
 *     [Framework Auto-Notification]
 *     Teammate "d3-b2-validator" completed successfully.
 *     Task: D3 B2 Validator 独立评审
 *     Duration: 13m 17s
 *     </teammate-message>
 *
 * Codeg already has the equivalent structured primitives for Claude Code
 * (`parsers/claude.rs::task_notification_*`) and Codex (`background-task.ts`);
 * this is the live-ACP counterpart for CodeBuddy's protocol.
 */

export const TEAMMATE_MESSAGE_OPEN = "<teammate-message"
export const TEAMMATE_MESSAGE_CLOSE = "</teammate-message>"

export type TeammateTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "killed"

export interface TeammateMessageBase {
  /** `teammate_id` attribute; "system" for framework notifications. */
  teammateId: string | null
  /** `summary` attribute (may contain HTML entities and newlines). */
  summary: string | null
  /** The raw inner text, trimmed. */
  body: string
  /** True while streaming, before the closing tag has arrived. */
  isStreaming: boolean
}

export interface TeammateResultMessage extends TeammateMessageBase {
  kind: "result"
}

export interface TeammateNotificationMessage extends TeammateMessageBase {
  kind: "notification"
  /** The member name extracted from `Teammate "x" …` / `Background agent "x" …`. */
  memberName: string | null
  status: TeammateTerminalStatus | null
  task: string | null
  duration: string | null
  error: string | null
}

export type TeammateMessage =
  | TeammateResultMessage
  | TeammateNotificationMessage

const NOTIFICATION_MARKER = "[Framework Auto-Notification]"

const STATUS_WORDS: Record<string, TeammateTerminalStatus> = {
  "completed successfully": "completed",
  failed: "failed",
  "was cancelled": "cancelled",
  "was stopped": "killed",
}

/** Minimal entity decode, mirroring `unescape_task_notification_text`. */
export function unescapeTeammateText(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

function attr(raw: string, name: string): string | null {
  // Attributes may be single- or double-quoted and can span lines.
  const match = raw.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "s")
  )
  if (!match) return null
  return unescapeTeammateText(match[2] ?? match[3] ?? "").trim() || null
}

function parseNotification(
  base: TeammateMessageBase
): TeammateNotificationMessage {
  const body = base.body
  const memberMatch = body.match(
    /(?:Teammate|Background agent)\s+"([^"]+)"\s+([^\n.]+)/
  )
  const memberName = memberMatch?.[1]?.trim() ?? null
  const statusPhrase = memberMatch?.[2]?.trim().toLowerCase() ?? ""
  let status: TeammateTerminalStatus | null = null
  for (const [word, value] of Object.entries(STATUS_WORDS)) {
    if (statusPhrase.includes(word)) {
      status = value
      break
    }
  }
  const line = (label: string): string | null =>
    body.match(new RegExp(`^${label}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null

  return {
    ...base,
    kind: "notification",
    memberName,
    status,
    task: line("Task"),
    duration: line("Duration"),
    error: line("Error"),
  }
}

/**
 * Parse ONE `<teammate-message …>…</teammate-message>` envelope starting at
 * `text[start]`. Returns null when `text` does not start with an opening tag.
 * An unclosed envelope is accepted (body runs to end of text) so a live stream
 * can show the card while it grows, exactly like `expandProposedPlanText`.
 */
export function parseTeammateEnvelope(
  text: string,
  start: number,
  isStreaming: boolean
): { message: TeammateMessage; end: number } | null {
  if (!text.startsWith(TEAMMATE_MESSAGE_OPEN, start)) return null

  const tagEnd = text.indexOf(">", start)
  if (tagEnd === -1) return null
  const rawTag = text.slice(start, tagEnd + 1)

  const close = text.indexOf(TEAMMATE_MESSAGE_CLOSE, tagEnd + 1)
  const stillStreaming = close === -1
  const body = text
    .slice(tagEnd + 1, stillStreaming ? text.length : close)
    .trim()

  const base: TeammateMessageBase = {
    teammateId: attr(rawTag, "teammate_id"),
    summary: attr(rawTag, "summary"),
    body,
    isStreaming: stillStreaming && isStreaming,
  }

  const message: TeammateMessage =
    body.includes(NOTIFICATION_MARKER) || base.teammateId === "system"
      ? parseNotification(base)
      : { ...base, kind: "result" }

  return {
    message,
    end: stillStreaming ? text.length : close + TEAMMATE_MESSAGE_CLOSE.length,
  }
}

/** Whether a text block contains a teammate envelope (cheap pre-check). */
export function hasTeammateMessage(text: string): boolean {
  return text.includes(TEAMMATE_MESSAGE_OPEN)
}
