/**
 * Chat feature barrel — the thread store + the `/api/v1/ai/chat` call.
 *
 * The full-page overlay (ChatPage / ChatActivator / ChatProvider) was
 * removed: nothing mounted it since chat became a mode inside the
 * analyst page (`features/analyst/analyst-chat-mode.jsx`), which is the
 * only consumer of this barrel.
 */
export {
  useChat,
  appendMessage,
  removeMessage,
  clearMessages,
  sendChatMessage,
  sendAndAppend,
} from "./use-chat";
