"use client";

import { Sparkles } from "lucide-react";
import { Button, Badge } from "@/components/ui";
import { useChat } from "./use-chat";
import { useChatState } from "./chat-provider";

/**
 * Header button that opens the chat page.
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
    <Button
      variant="tint"
      tone="lav"
      size="sm"
      onClick={() => setOpen(true)}
      aria-label="Open Hubs assistant"
    >
      <Sparkles size={14} />
      Ask Hubs
      {hasConversation ? <Badge dot tone="mint" /> : null}
    </Button>
  );
}
