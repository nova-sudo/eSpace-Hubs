"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { DitherField } from "@/components/ui";
import {
  appendMessage,
  clearMessages,
  stubRespond,
  useChat,
} from "./use-chat";
import { useChatState } from "./chat-provider";

/**
 * Full-viewport chat page.
 *
 * Lives as a fixed sibling to the rest of the app. When `useChatState().open`
 * flips, this translates from `translateX(100%)` to `0`; in parallel,
 * AppShell transforms the dashboard body to `translateX(-100%)`. Together
 * they produce a single horizontal "swipe to the new page" transition.
 *
 * Inverse HexaCore theme: accent indigo ground, warm-paper ink.
 */
export function ChatPage() {
  const { open, close } = useChatState();
  const { messages } = useChat();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll the message list to the bottom when content grows.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, pending]);

  // Focus the composer shortly after the slide-in finishes.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, [open]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    appendMessage("user", text);
    setPending(true);
    try {
      const reply = await stubRespond(text);
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="DevHub assistant"
      aria-hidden={!open}
      className="fixed inset-0 z-[50] flex flex-col"
      style={{
        background: "var(--accent)",
        color: "var(--accent-on)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        // When closed, we keep the element mounted but make it non-interactive
        // so focus/click never land on it offscreen.
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
        // Delay the visibility flip until after the slide-out finishes.
        transitionProperty: "transform, visibility",
        transitionDuration: "320ms, 0s",
        transitionDelay: open ? "0s, 0s" : "0s, 320ms",
      }}
    >
      {/* Decorative dither field — faint, positioned like on the Export tile
          for brand consistency. Non-interactive; sits behind content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 opacity-30"
        style={{ color: "#ffffff" }}
      >
        <DitherField
          width={1720}
          height={1720}
          cell={8}
          color="currentColor"
          falloff={(u, v) =>
            Math.max(0, 1 - Math.sqrt((u - 0.6) ** 2 + (v - 0.3) ** 2) * 1.3)
          }
          jitter={0.35}
          seed={13}
        />
      </div>

      <ChatPageHeader onClose={close} />

      <main className="relative z-[1] mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col px-8 pb-6">
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
      </main>
    </div>
  );
}

function ChatPageHeader({ onClose }) {
  return (
    <header
      className="relative z-[1] flex items-center justify-between gap-3 border-b px-8 py-3"
      style={{ borderColor: "rgba(255,255,255,0.15)" }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to dashboard"
          className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{ color: "#ffffff" }}
        >
          <BackGlyph />
        </button>
        <div>
          <div
            className="font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              letterSpacing: "-0.3px",
            }}
          >
            DevHub assistant
          </div>
          <div
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            Inverse · local only
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => clearMessages()}
          className="rounded-[var(--radius-sub)] px-3 py-1.5 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.5px",
            color: "rgba(255,255,255,0.82)",
          }}
        >
          Clear thread
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="rounded-[var(--radius-sub)] px-3 py-1.5 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.5px",
            color: "#ffffff",
          }}
        >
          Esc ✕
        </button>
      </div>
    </header>
  );
}

function ChatBubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[75%] rounded-[var(--radius-tile)] px-4 py-3 text-[14px] mt-2 leading-[1.55]"
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
        animation: "devhubChatDot 1s ease-in-out infinite",
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
          style={{
            color: "#ffffff",
            fontFamily: "var(--font-sans)",
          }}
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
      <div
        className="mt-2 uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        Enter to send · Shift + Enter for newline · Esc to close
      </div>
      {/* Scoped keyframes for the typing indicator. */}
      <style>{`
        @keyframes devhubChatDot {
          0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </form>
  );
});

function BackGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
