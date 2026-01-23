import { useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  assistantDraft?: string;
  planSteps: string[] | null;
  status: string;
  onSend: (message: string) => void;
}

export const ChatPanel = ({ messages, assistantDraft, planSteps, status, onSend }: ChatPanelProps) => {
  const [value, setValue] = useState("");

  const handleSend = () => {
    if (!value.trim()) {
      return;
    }
    onSend(value.trim());
    setValue("");
  };

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Session</p>
          <h2>Task Flow</h2>
        </div>
        <span className={`status-pill ${status}`}>{status}</span>
      </header>

      {planSteps && (
        <div className="plan-card">
          <div className="plan-header">
            <h3>Proposed Plan</h3>
            <button className="ghost-button">Lock plan</button>
          </div>
          <ol>
            {planSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="chat-stream">
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            <div className="message-meta">
              <span>{message.role === "user" ? "You" : "Sidekick"}</span>
              <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
            </div>
            <p>{message.text}</p>
          </div>
        ))}

        {assistantDraft && (
          <div className="message assistant draft">
            <div className="message-meta">
              <span>Sidekick</span>
              <span>typing</span>
            </div>
            <p>{assistantDraft}</p>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          placeholder="Describe what you want Sidekick to do"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={3}
        />
        <div className="composer-actions">
          <div className="composer-hint">Shift + Enter for newline</div>
          <button className="primary-button" onClick={handleSend}>
            Send task
          </button>
        </div>
      </div>
    </section>
  );
};
