import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight, Trash } from "@phosphor-icons/react";
import type { Message } from "@saladereunioes/shared";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";

interface ChatPanelProps {
  messages: Message[];
  userMap: Map<string, string>;
  currentUserId: string;
  isAdmin: boolean;
  onSend: (content: string) => void;
  onDeleteMessage: (messageId: string) => void;
}

export function ChatPanel({
  messages,
  userMap,
  currentUserId,
  isAdmin,
  onSend,
  onDeleteMessage,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <div className="chat-panel">
      <div className="messages">
        {messages.map((msg) => {
          const author = userMap.get(msg.authorId) ?? msg.authorId;
          const isOwn = msg.authorId === currentUserId;
          const time = new Date(msg.createdAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          });

          const canDelete = isOwn || isAdmin;

          return (
            <div key={msg.id} className={`message ${isOwn ? "own" : ""}`}>
              <Avatar />
              <div className="message-body">
                <div className="message-meta">
                  <span className="message-author">{author}</span>
                  <span className="message-time">{time}</span>
                  {canDelete && (
                    <button
                      className="message-delete-button"
                      onClick={() => setPendingDeleteId(msg.id)}
                      aria-label="Apagar mensagem"
                    >
                      <Trash size={14} />
                    </button>
                  )}
                </div>
                <p className="message-content">{msg.content}</p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form className="message-input" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="roundtable"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4000}
        />
        <button type="submit" aria-label="Enviar">
          <PaperPlaneRight size={24} />
        </button>
      </form>

      {pendingDeleteId && (
        <ConfirmDialog
          message="Apagar esta mensagem?"
          onConfirm={() => {
            onDeleteMessage(pendingDeleteId);
            setPendingDeleteId(null);
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
}
