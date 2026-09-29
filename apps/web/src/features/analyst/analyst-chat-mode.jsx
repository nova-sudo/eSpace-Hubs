"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp } from "lucide-react";
import { Button, IconButton, Label } from "@/components/ui";
import { clearMessages, sendAndAppend, useChat } from "@/features/chat";

/**
 * Chat sub-view hosted inside the analyst page.
 *
 * Uses the existing `@/features/chat` store + API — all we do here is
 * render the UI in the analyst page's own theme and plug it into the
 * mode toggle. Keeps chat as a real, reachable tool without promoting it
 * back to primary.
 */
export function AnalystChatMode() {
  const { messages } = useChat();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  // A failed send: `{ text, message }`. Rendered as a transient row with
  // Retry — never appended to the thread as if the assistant had spoken.
  const [failed, setFailed] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, pending, failed]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(t);
  }, []);

  async function send(text) {
    if (!text || pending) return;
    setFailed(null);
    setPending(true);
    // Clear the composer NOW: the user bubble is appended immediately, so
    // leaving the same text in the box showed the message twice — and a
    // success-time clear would wipe a next question typed meanwhile.
    setDraft("");
    try {
      // Appends the user turn, sends, appends the reply — and REMOVES the
      // user turn again on failure, so a retry never doubles it.
      await sendAndAppend(text);
    } catch (err) {
      // Give the words back (unless something new was typed): the draft is
      // what they'd otherwise retype.
      setDraft((d) => (d.trim() ? d : text));
      setFailed({ text, message: err?.message || "Couldn't reach the assistant." });
    } finally {
      setPending(false);
    }
  }

  function handleSend() {
    void send(draft.trim());
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    if (messages.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Clear this thread? Its ${messages.length} message${messages.length === 1 ? "" : "s"} can't be recovered.`)
    ) {
      return;
    }
    setFailed(null);
    clearMessages();
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <Label>Chat</Label>
        <Button variant="ghost" size="sm" onClick={handleClear} disabled={messages.length === 0}>
          Clear thread
        </Button>
      </div>
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
      >
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {pending ? <TypingBubble /> : null}
        {failed && !pending ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] bg-peach px-3.5 py-2.5 text-[12.5px] text-peach-ink"
          >
            <span className="min-w-0 flex-1">Not sent — {failed.message}</span>
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="soft" onClick={() => void send(failed.text)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFailed(null)}>
                Dismiss
              </Button>
            </span>
          </div>
        ) : null}
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
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[74%] whitespace-pre-wrap rounded-[var(--radius-xl)] bg-lav p-4 text-[14px] leading-[1.55] text-lav-ink">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className="flex max-w-[74%] items-start gap-2 rounded-[var(--radius-xl)] bg-card p-4 text-[14px] leading-[1.55] text-fg"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <Sparkles size={16} className="mt-0.5 shrink-0 text-lav-text" />
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
    <div className="mt-4 flex h-12 flex-none items-center gap-2 rounded-[var(--radius-lg)] bg-card-alt px-3.5">
      <textarea
        ref={ref}
        rows={1}
        placeholder="Ask about your work…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        // Read-only (not disabled — focus stays put) while a reply is on
        // its way, so the next question can't be typed into a send race.
        readOnly={pending}
        aria-busy={pending || undefined}
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
  );
});
