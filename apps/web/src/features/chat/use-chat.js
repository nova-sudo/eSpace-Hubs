"use client";

/**
 * Chat feature — client-only store for the conversation + a thin wrapper
 * around the `/api/chat` server route that proxies to Mistral.
 *
 * Messages persist to localStorage so reopening the chat keeps the thread.
 * A custom event + `useSyncExternalStore` lets multiple hooks subscribe
 * without React context.
 */

import { useSyncExternalStore } from "react";

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
      content:
        "Hey — this is your DevHub assistant. Ask about your PRs, Jira tickets, review turnaround, or anything you see on the dashboard.",
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
 * Send the current thread to the chat backend (`/api/chat` → Mistral) and
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

  // Read the user's provider preference (mistral | glm) from localStorage
  // and ship it via BOTH the header and the body — server-side
  // `selectProvider()` checks header first, body second, env third.
  const provider =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("espace-devhub:ai-provider") || "mistral"
      : "mistral";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ai-provider": provider,
    },
    body: JSON.stringify({ messages, provider }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Chat API ${res.status}`);
  }
  if (!body?.content) {
    throw new Error("Chat API returned an empty reply.");
  }
  return body.content;
}

/**
 * Alias kept for callers that still reference `stubRespond`. Delete once
 * all imports are migrated — it simply proxies to `sendChatMessage`.
 */
export const stubRespond = sendChatMessage;
