"use client";

import { useChat } from "./use-chat";
import { useChatState } from "./chat-provider";

/**
 * Header pill that opens the chat page. Inverse theme: accent fill, white ink.
 *
 * Doesn't render the chat page itself — that lives at the AppShell level,
 * as a fixed sibling to the dashboard body, so a single context flip can
 * translate both views together (dashboard slides left, chat slides in
 * from right).
 */
export function ChatActivator() {
  const { setOpen } = useChatState();
  const { messages } = useChat();
  const hasConversation = messages.length > 1; // one is the welcome

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open DevHub assistant"
      className="group relative inline-flex items-center gap-2 rounded-full border-0 px-3.5 py-1.5 transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(56,38,255,0.28)]"
      style={{
        background: "var(--accent)",
        color: "var(--accent-on)",
      }}
    >
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full"
        style={{ background: "rgba(255,255,255,0.22)" }}
      >
        <SparkleGlyph />
      </span>
      <span
        className="font-bold uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.6px",
        }}
      >
        Ask DevHub
      </span>
      {hasConversation ? (
        <span
          aria-label="active conversation"
          className="block h-1.5 w-1.5 rounded-full"
          style={{
            background: "var(--accent-2)",
            boxShadow: "0 0 0 3px rgba(0,196,138,0.25)",
          }}
        />
      ) : null}
    </button>
  );
}

function SparkleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z"
        fill="currentColor"
      />
    </svg>
  );
}
