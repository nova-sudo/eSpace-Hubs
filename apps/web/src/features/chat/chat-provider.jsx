"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * App-wide open/close state for the chat overlay.
 *
 * Lifted to a context because the trigger (button in the header) and the
 * consumer of the transform (the dashboard body + chat page) are siblings
 * under AppShell. A context keeps the wiring light — no global store, no
 * URL state, no prop-drilling.
 */
const ChatContext = createContext({
  open: false,
  // eslint-disable-next-line no-unused-vars
  setOpen: (_value) => {},
  close: () => {},
  toggle: () => {},
});

export function ChatProvider({ children }) {
  const [open, setOpen] = useState(false);

  // Hide page overflow while the chat is swiped in. The page slides
  // `translateX(-100%)` and the chat slides in from +100%; without
  // `overflow-x: hidden` on the root, browsers would expose a 200%-wide
  // scroll area and let the user drag the page back mid-animation.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.documentElement.style.overflowX;
    document.documentElement.style.overflowX = "hidden";
    return () => {
      document.documentElement.style.overflowX = prev;
    };
  }, []);

  // Escape anywhere closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const value = {
    open,
    setOpen,
    close: () => setOpen(false),
    toggle: () => setOpen((v) => !v),
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatState() {
  return useContext(ChatContext);
}
