"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { X, Sparkles, ArrowUp } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { appendMessage, clearMessages, stubRespond, useChat } from "./use-chat";
import { useChatState } from "./chat-provider";

/**
 * Full-viewport chat page.
 *
 * Lives as a fixed sibling to the rest of the app. When `useChatState().open`
 * flips, this translates from `translateX(100%)` to `0`; in parallel,
 * AppShell transforms the dashboard body to `translateX(-100%)`. Together
 * they produce a single horizontal "swipe to the new page" transition.
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
      aria-label="Hubs assistant"
      aria-hidden={!open}
      className="fixed inset-0 z-[50] flex flex-col bg-bg text-fg"
      style={{
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
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-10">
        <h1 className="text-[18px] font-bold tracking-[-0.01em] text-fg">Hubs assistant</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => clearMessages()}>
            Clear thread
          </Button>
          <IconButton label="Close assistant" onClick={close}>
            <X size={18} />
          </IconButton>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col px-4 pb-6 sm:px-8">
        <div
          ref={listRef}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 pt-6"
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

function ChatBubble({ role, content }) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] whitespace-pre-wrap rounded-[var(--radius-xl)] bg-lav p-4 text-[14px] leading-[1.55] text-lav-ink">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className="flex max-w-[75%] items-start gap-2 rounded-[var(--radius-xl)] bg-card p-4 text-[14px] leading-[1.55] text-fg"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <Sparkles size={16} className="mt-0.5 shrink-0 text-lav-ink" />
        <span className="whitespace-pre-wrap">{content}</span>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div
        className="flex items-center gap-1.5 rounded-[var(--radius-xl)] bg-card p-4 text-fg"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

const ChatComposer = forwardRef(function ChatComposer(
  { value, onChange, onKeyDown, onSend, pending },
  ref,
) {
  const canSend = !pending && value.trim().length > 0;
  return (
    <div className="mt-4 flex-none">
      <div className="flex h-12 items-center gap-2 rounded-[var(--radius-lg)] bg-card-alt px-3.5">
        <textarea
          ref={ref}
          rows={1}
          placeholder="Ask about your work…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-full min-h-0 flex-1 resize-none bg-transparent text-[14px] leading-[1.5] text-fg outline-none placeholder:text-dim-fg"
        />
        <IconButton
          label="Send message"
          size="sm"
          active={canSend}
          onClick={() => canSend && onSend()}
          disabled={!canSend}
          className={canSend ? undefined : "opacity-50"}
        >
          <ArrowUp size={15} />
        </IconButton>
      </div>
      <div className="mt-2 text-[12px] text-dim-fg">
        Enter to send · Shift + Enter for newline · Esc to close
      </div>
    </div>
  );
});
