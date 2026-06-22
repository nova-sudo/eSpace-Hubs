"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import {
  appendMessage,
  clearMessages,
  sendChatMessage,
  useChat,
} from "@/features/chat";

/**
 * Chat sub-view hosted inside the analyst page.
 *
 * Uses the existing `@/features/chat` store + API — all we do here is
 * render the UI in the inverse theme and plug it into the analyst page's
 * mode toggle. Keeps chat as a real, reachable tool without promoting it
 * back to primary.
 */
export function AnalystChatMode() {
  const { messages } = useChat();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, pending]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(t);
  }, []);

  async function handleSend() {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    appendMessage("user", text);
    setPending(true);
    try {
      const reply = await sendChatMessage(text);
      appendMessage("assistant", reply);
    } catch (err) {
      appendMessage(
        "assistant",
        `Something broke while reaching the assistant. ${err?.message || ""}`,
      );
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col self-center">
      <div
        className="mb-2 flex items-center justify-between"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--muted-fg)",
        }}
      >
        <span className="uppercase tracking-[0.5px]">Secondary · chat</span>
        <button
          type="button"
          onClick={() => clearMessages()}
          className="uppercase transition-colors"
          style={{
            fontFamily: "var(--font-mono)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "6px 11px",
            color: "var(--muted-fg)",
          }}
        >
          Clear thread
        </button>
      </div>
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
      >
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {pending ? <TypingBubble /> : null}
      </div>
      <ChatComposer
        ref={inputRef}
        value={draft}
        onChange={setDraft}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        pending={pending}
      />
    </div>
  );
}

function ChatBubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[74%]"
        style={{
          borderRadius: 10,
          padding: "13px 16px",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          ...(isUser
            ? {
                background: "var(--bubble-user)",
                color: "#fff",
              }
            : {
                background: "var(--bubble-ai)",
                border: "1px solid var(--border)",
                color: "var(--fg)",
              }),
        }}
      >
        {content}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div
        style={{
          background: "var(--bubble-ai)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "13px 16px",
        }}
      >
        <span className="glyph-typing" style={{ display: "inline-flex", gap: 5 }}>
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

const ChatComposer = forwardRef(function ChatComposer(
  { value, onChange, onKeyDown, onSend, pending },
  ref,
) {
  return (
    <form
      className="mt-4 flex-none"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <div
        className="flex items-end gap-2"
        style={{
          border: "1px solid var(--border-strong)",
          borderRadius: 10,
          background: "var(--card)",
          padding: "11px 13px",
        }}
      >
        <textarea
          ref={ref}
          rows={1}
          placeholder="Ask about your work…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-[24px] max-h-[180px] flex-1 resize-none bg-transparent text-[14px] leading-[1.5] outline-none placeholder:text-[var(--dim-fg)]"
          style={{ color: "var(--fg)", fontFamily: "var(--font-sans)" }}
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          aria-label="Send message"
          className="inline-flex items-center gap-1 rounded-[var(--radius-sub)] px-3 py-2 uppercase transition-opacity disabled:opacity-45"
          style={{
            background: "var(--accent)",
            color: "var(--accent-on)",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.6px",
          }}
        >
          Send ↵
        </button>
      </div>
    </form>
  );
});
