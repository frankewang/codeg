"use client"

import { useTranslations } from "next-intl"
import type { DbConversationSummary, SessionStats } from "@/lib/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SessionDetailsContent } from "./session-details-content"

interface SessionDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: DbConversationSummary
  /**
   * Pre-loaded session stats. When a value (or `null`) is passed the dialog
   * trusts it and renders without a fetch — the detail panel reads it straight
   * from the live runtime session. When `undefined` (the sidebar card, which
   * only holds the summary) the dialog fetches the conversation detail on open
   * to fill in token usage. Forwarded verbatim to `SessionDetailsContent`.
   */
  stats?: SessionStats | null
  /**
   * Pre-resolved model name, following the same contract as `stats`. A value
   * (or `null`) is trusted as-is — the detail panel resolves it from the live
   * session's turns. `undefined` (the sidebar card) makes the content derive
   * the model from the conversation detail it fetches, since
   * `DbConversationSummary.model` is empty for sessions started live in-app.
   */
  model?: string | null
}

export function SessionDetailsDialog({
  open,
  onOpenChange,
  summary,
  stats,
  model,
}: SessionDetailsDialogProps) {
  const t = useTranslations("Folder.sessionDetails")

  // The dialog is portalled to <body>, but React synthetic events still bubble
  // through the React tree — and this dialog is rendered from a sidebar
  // conversation card that sits inside a Radix ContextMenuTrigger. On touch
  // devices that trigger arms a long-press on pointerdown, so a long-press to
  // select text here would open the sidebar menu and Radix would
  // preventDefault() the native "Copy" menu. Stop both gestures at the content
  // boundary so text stays selectable/copyable. Mouse pointerdown passes
  // through: desktop right-click is unchanged.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onContextMenu={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          // Only touch/pen arm the long-press menu. An absent pointerType
          // (some WebViews synthesise pointerdown from MouseEvent) must keep
          // desktop behaviour rather than being swallowed here.
          if (event.pointerType === "touch" || event.pointerType === "pen") {
            event.stopPropagation()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {/* `active` mirrors `open` so the sidebar cold-fetch only runs while
            the dialog is shown, preserving the pre-extraction behavior. */}
        <SessionDetailsContent
          summary={summary}
          stats={stats}
          model={model}
          active={open}
        />
      </DialogContent>
    </Dialog>
  )
}
