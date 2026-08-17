import { useEffect, useRef, useState } from "react";
import type { Message } from "@saladereunioes/shared";

interface ChatPanelProps {
  channelName: string;
  messages: Message[];
  userMap: Map<string, string>;
  currentUserId: string;
  onSend: (content: string) => void;
}

export function ChatPanel({
  channelName,
  messages,
  userMap,
  currentUserId,
  onSend,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
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
      <header className="chat-header">
        <h2># {channelName}</h2>
      </header>

      <div className="messages">
        {messages.map((msg) => {
          const author = userMap.get(msg.authorId) ?? msg.authorId;
          const isOwn = msg.authorId === currentUserId;
          const time = new Date(msg.createdAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          });

          return (
            <div key={msg.id} className={`message ${isOwn ? "own" : ""}`}>
              <span className="message-author">{author}</span>
              <span className="message-time">{time}</span>
              <p className="message-content">{msg.content}</p>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form className="message-input" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="mensagem..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4000}
        />
        <button type="submit">Enviar</button>
      </form>
    </div>
  );
}
