import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { TeammateMessage } from "@/lib/teammate-message"
import { TeammateMessageCard } from "./teammate-message-card"

function renderCard(message: TeammateMessage) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TeammateMessageCard message={message} />
    </NextIntlClientProvider>
  )
}

const RESULT: TeammateMessage = {
  kind: "result",
  teammateId: "d3-b2-validator",
  summary: "M4-D3 B2 Validator: NEEDS_WORK, 9 major",
  body: "Findings 摘要：\n- V-1 major: DAG 反向依赖",
  isStreaming: false,
}

const NOTIFICATION: TeammateMessage = {
  kind: "notification",
  teammateId: "system",
  summary: "d3-b2-validator completed: D3 B2 Validator 独立评审",
  body: "[Framework Auto-Notification] …",
  memberName: "d3-b2-validator",
  status: "completed",
  task: "D3 B2 Validator 独立评审",
  duration: "13m 17s",
  error: null,
}

describe("TeammateMessageCard", () => {
  it("collapses a result to one line by default and expands on click", () => {
    const { container } = renderCard(RESULT)
    expect(
      container.querySelector('[data-codeg="teammate-result"]')
    ).not.toBeNull()
    expect(screen.getByText(/NEEDS_WORK, 9 major/)).not.toBeNull()
    // Body is hidden until expanded — this is what removes the "一段一段" wall.
    expect(screen.queryByText(/DAG 反向依赖/)).toBeNull()
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText(/DAG 反向依赖/)).not.toBeNull()
  })

  it("never renders the raw XML envelope", () => {
    const { container } = renderCard(RESULT)
    expect(container.textContent).not.toContain("<teammate-message")
    expect(container.textContent).not.toContain("</teammate-message>")
  })

  it("renders a notification as one compact row without the framework boilerplate", () => {
    const { container } = renderCard(NOTIFICATION)
    expect(
      container.querySelector('[data-codeg="teammate-notification"]')
    ).not.toBeNull()
    expect(screen.getByText("d3-b2-validator")).not.toBeNull()
    expect(screen.getByText("D3 B2 Validator 独立评审")).not.toBeNull()
    expect(screen.getByText("13m 17s")).not.toBeNull()
    expect(container.textContent).not.toContain("[Framework Auto-Notification]")
  })

  it("shows an error line for a failed member", () => {
    const { container } = renderCard({
      ...NOTIFICATION,
      status: "failed",
      error: "boom happened",
      duration: null,
    })
    expect(container.textContent).toContain("boom happened")
  })

  it("keeps hooks stable across kind changes (no conditional hook)", () => {
    const { rerender } = renderCard(RESULT)
    expect(() =>
      rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <TeammateMessageCard message={NOTIFICATION} />
        </NextIntlClientProvider>
      )
    ).not.toThrow()
  })
})
