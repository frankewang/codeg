"use client"

/**
 * Structured rendering for CodeBuddy's teammate (sub-agent) messages.
 *
 * CodeBuddy's team framework injects sub-agent results and completion notices
 * into the lead's transcript as plain `<teammate-message>` text. Rendered
 * verbatim, each one becomes a long raw-text block with visible XML tags — and
 * because the framework emits a separate `[Framework Auto-Notification]` for
 * every member, a two-reviewer round produces four near-duplicate blocks.
 *
 * Here:
 *  - a *result* is a collapsible card (collapsed by default) titled with the
 *    summary, so the transcript stays one line per sub-agent;
 *  - a *notification* is a single compact status row (member · status · task
 *    · duration), with the `[Framework Auto-Notification]` boilerplate removed.
 *
 * This mirrors what codeg already does for Claude Code's `<task-notification>`
 * (`lib/background-task.ts`) and Codex plan blocks (`proposed-plan`), so all
 * agents' sub-agent output reads the same way. No new i18n keys: the expand
 * affordance reuses `Folder.chat.messageList.showMore / showLess`.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock3,
  XCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { TeammateMessage } from "@/lib/teammate-message"
import { MessageResponse } from "@/components/ai-elements/message"

const STATUS_STYLE: Record<
  string,
  { icon: typeof CheckCircle2; className: string }
> = {
  completed: { icon: CheckCircle2, className: "text-emerald-600" },
  failed: { icon: XCircle, className: "text-destructive" },
  cancelled: { icon: CircleDashed, className: "text-muted-foreground" },
  killed: { icon: CircleDashed, className: "text-muted-foreground" },
}

export function TeammateMessageCard({ message }: { message: TeammateMessage }) {
  const t = useTranslations("Folder.chat.messageList")
  // Hooks must be unconditional: the notification branch returns early.
  const [expanded, setExpanded] = useState(false)

  if (message.kind === "notification") {
    const style = STATUS_STYLE[message.status ?? ""] ?? STATUS_STYLE.cancelled
    const Icon = style.icon
    return (
      <div
        data-codeg="teammate-notification"
        className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
      >
        <Icon className={cn("size-3.5 shrink-0", style.className)} />
        <span className="min-w-0 truncate font-medium text-foreground">
          {message.memberName ?? message.teammateId ?? "system"}
        </span>
        {message.task && (
          <span className="min-w-0 truncate">{message.task}</span>
        )}
        {message.error && (
          <span className="min-w-0 truncate text-destructive">
            {message.error}
          </span>
        )}
        {message.duration && (
          <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
            <Clock3 className="size-3" />
            {message.duration}
          </span>
        )}
      </div>
    )
  }

  const title = message.summary ?? message.teammateId ?? t("showMore")
  return (
    <div
      data-codeg="teammate-result"
      className="overflow-hidden rounded-lg border bg-muted/20"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? t("showLess") : t("showMore")}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {message.teammateId && (
          <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
            {message.teammateId}
          </span>
        )}
        {message.isStreaming && (
          <CircleDashed className="size-3 shrink-0 animate-spin text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t px-3 py-2 text-sm">
          {message.body ? (
            <MessageResponse>{message.body}</MessageResponse>
          ) : (
            <span className="text-xs text-muted-foreground">…</span>
          )}
        </div>
      )}
    </div>
  )
}
