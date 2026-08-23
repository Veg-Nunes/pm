"use client";

import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { sendChatMessage, SessionExpiredError, type ChatMessage } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

type ChatSidebarProps = {
  onBoardUpdate: (board: BoardData) => void;
  onSessionExpired: () => void;
};

export const ChatSidebar = ({ onBoardUpdate, onSessionExpired }: ChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSending) {
      return;
    }

    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setError(null);
    setIsSending(true);

    try {
      const result = await sendChatMessage(message, history);
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
      if (result.boardUpdate) {
        onBoardUpdate(result.boardUpdate);
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        onSessionExpired();
        return;
      }
      setError("The assistant didn't respond. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <aside
      aria-label="AI assistant"
      className="flex h-fit w-full flex-col rounded-[32px] border border-[var(--stroke)] bg-white/80 p-6 shadow-[var(--shadow)] backdrop-blur 2xl:sticky 2xl:top-12 2xl:w-[340px]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
        Assistant
      </p>
      <h2 className="mt-2 font-display text-lg font-semibold text-[var(--navy-dark)]">
        Ask the board AI
      </h2>

      <div
        data-testid="chat-messages"
        className="mt-4 flex max-h-[420px] flex-col gap-3 overflow-y-auto"
      >
        {messages.length === 0 && (
          <p className="text-sm leading-6 text-[var(--gray-text)]">
            Try &ldquo;Add a card called Buy stapler to Backlog.&rdquo;
          </p>
        )}
        {messages.map((message, index) => (
          <p
            key={index}
            className={clsx(
              "rounded-2xl px-3 py-2 text-sm leading-5",
              message.role === "user"
                ? "ml-6 bg-[var(--primary-blue)]/10 text-[var(--navy-dark)]"
                : "mr-6 bg-[var(--surface)] text-[var(--navy-dark)]"
            )}
          >
            {message.content}
          </p>
        ))}
        {isSending && (
          <p role="status" className="text-xs text-[var(--gray-text)]">
            Thinking...
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the assistant..."
          aria-label="Chat message"
          disabled={isSending}
          className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="shrink-0 rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </aside>
  );
};
