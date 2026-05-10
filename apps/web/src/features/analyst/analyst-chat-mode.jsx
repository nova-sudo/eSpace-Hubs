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
    <div className="flex min-h-0 w-full max-w-[820px] flex-1 flex-col self-center">
      <div
        className="mb-2 flex items-center justify-between"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        <span className="uppercase tracking-[0.5px]">Secondary · chat</span>
        <button
          type="button"
          onClick={() => clearMessages()}
          className="rounded-[var(--radius-sub)] px-2 py-1 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{ color: "rgba(255,255,255,0.8)" }}
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
        className="max-w-[75%] rounded-[var(--radius-tile)] px-4 py-3 text-[14px] leading-[1.55]"
        style={
          isUser
            ? {
                background: "var(--card-alt)",
                color: "var(--fg)",
                whiteSpace: "pre-wrap",
              }
            : {
                background: "rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.95)",
                border: "1px solid rgba(255,255,255,0.18)",
                whiteSpace: "pre-wrap",
              }
        }
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
        className="flex items-center gap-1 rounded-[var(--radius-tile)] px-4 py-3"
        style={{
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
        }}
      >
        <Dot delay={0} />
        <Dot delay={120} />
        <Dot delay={240} />
      </div>
    </div>
  );
}

function Dot({ delay }) {
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-1.5 rounded-full"
      style={{
        background: "rgba(255,255,255,0.75)",
        animation: "analystChatDot 1s ease-in-out infinite",
        animationDelay: `${delay}ms`,
      }}
    />
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
        className="flex items-end gap-2 rounded-[var(--radius-tile)] px-3 py-2.5"
        style={{
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.22)",
        }}
      >
        <textarea
          ref={ref}
          rows={1}
          placeholder="Ask about your work…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-[24px] max-h-[180px] flex-1 resize-none bg-transparent text-[14px] leading-[1.5] outline-none"
          style={{ color: "#ffffff", fontFamily: "var(--font-sans)" }}
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          aria-label="Send message"
          className="inline-flex items-center gap-1 rounded-[var(--radius-sub)] px-3 py-2 uppercase transition-opacity disabled:opacity-45"
          style={{
            background: "#ffffff",
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.6px",
          }}
        >
          Send ↵
        </button>
      </div>
      <style>{`
        @keyframes analystChatDot {
          0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </form>
  );
});
