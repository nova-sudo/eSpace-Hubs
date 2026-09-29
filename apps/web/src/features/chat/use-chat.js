"use client";

/**
 * Chat feature — client-only store for the conversation + a thin wrapper
 * around the API service's `/api/v1/ai/chat` endpoint.
 *
 * Messages persist to localStorage so reopening the chat keeps the thread.
 * A custom event + `useSyncExternalStore` lets multiple hooks subscribe
 * without React context.
 */

import { useSyncExternalStore } from "react";
import { getAiProvider } from "@/features/analyst";

const STORAGE_KEY = "espace-devhub:chat";
const CHANGE_EVENT = "chat:change";

function read() {
  if (typeof window === "undefined") return defaultThread();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.messages)) return defaultThread();
    return parsed;
  } catch {
    return defaultThread();
  }
}

function write(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// The welcome thread MUST be stable across calls — `useSyncExternalStore`
// compares snapshots with `Object.is`, so if `defaultThread()` returned a
// fresh `Date.now()` each call, every render would see a new snapshot and
// trigger an infinite re-render loop. Freeze the welcome payload at module
// load time instead.
const WELCOME_THREAD = Object.freeze({
  messages: [
    Object.freeze({
      id: "welcome",
      role: "assistant",
      // Honest scope: the endpoint sends the thread and nothing else — the
      // assistant can't see your PRs, tickets or dashboard numbers.
      content:
        "Hi — this is the Hubs assistant. I can't see your PRs, tickets or dashboard numbers, so paste in what you want to talk through: a goal, a review comment, a plan. I'll help you think it out.",
      ts: 0,
    }),
  ],
});

function defaultThread() {
  // Return a shallow copy so downstream mutations (in `appendMessage`) can
  // push to `messages` without hitting the frozen array.
  return { messages: [...WELCOME_THREAD.messages] };
}

function subscribe(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return JSON.stringify(read());
}

function getServerSnapshot() {
  return JSON.stringify(defaultThread());
}

export function useChat() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return JSON.parse(raw);
}

export function appendMessage(role, content) {
  const state = read();
  state.messages.push({
    id: `${role}-${Date.now()}`,
    role,
    content,
    ts: Date.now(),
  });
  write(state);
}

export function clearMessages() {
  write(defaultThread());
}

/**
 * How many of the most recent turns to send as context to the model. Keeps
 * payload size bounded and stops the occasional rambling thread from
 * pushing us past Mistral's context window or racking up tokens.
 */
const CONTEXT_WINDOW_TURNS = 12;

/**
 * Send the current thread to the chat backend (`/api/v1/ai/chat`) and
 * return the assistant's reply as a string. Throws on network / API
 * failures — the UI catches and shows the message in an assistant bubble.
 *
 * Callers append the user turn via `appendMessage("user", text)` BEFORE
 * invoking this. We then read the full thread from localStorage (minus
 * the frozen welcome placeholder) and ship the last N turns — the most
 * recent of which is the user message that just triggered this call, so
 * we do NOT re-append `userMessage` here. The argument is kept for a
 * possible future caller that wants to fire "fire and forget" without
 * persisting first, but today it's unused.
 */
// eslint-disable-next-line no-unused-vars
export async function sendChatMessage(_userMessage) {
  const state = read();
  const messages = state.messages
    .filter((m) => m.id !== "welcome")
    .slice(-CONTEXT_WINDOW_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0) {
    throw new Error("Nothing to send — write a message first.");
  }

  // Read the user's provider preference and ship it via BOTH the header
  // and the body — server-side `selectProvider()` checks header first,
  // body second, env third. Sourced from the synced prefs store (C7).
  const provider = getAiProvider();

  const res = await fetch("/api/v1/ai/chat", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-ai-provider": provider,
    },
    body: JSON.stringify({ messages, provider }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || body?.error || `Chat API ${res.status}`);
  }
  if (!body?.content) {
    throw new Error("Chat API returned an empty reply.");
  }
  return body.content;
}

/**
 * Remove one message (by id) — lets a UI drop a user turn whose send
 * failed so a retry doesn't double it.
 */
export function removeMessage(id) {
  const state = read();
  const next = state.messages.filter((m) => m.id !== id);
  if (next.length === state.messages.length) return;
  write({ ...state, messages: next });
}

/**
 * Whole send in one call, without polluting the thread on failure:
 * appends the user turn, calls the API, appends the reply. On error the
 * user turn is REMOVED again and the error is thrown, so the caller can
 * render a transient error row with Retry and restore the draft. The
 * thread only ever holds real user/assistant turns.
 */
export async function sendAndAppend(text) {
  const content = typeof text === "string" ? text.trim() : "";
  if (!content) throw new Error("Nothing to send — write a message first.");
  const userId = `user-${Date.now()}`;
  const state = read();
  state.messages.push({ id: userId, role: "user", content, ts: Date.now() });
  write(state);
  try {
    const reply = await sendChatMessage(content);
    appendMessage("assistant", reply);
    return reply;
  } catch (err) {
    removeMessage(userId);
    throw err;
  }
}
