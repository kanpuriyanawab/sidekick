import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

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
  onSend: (message: string) => Promise<boolean>;
  onSelectFolder: () => void;
  selectedFolder?: string;
  models: string[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  title: string;
  onTitleChange: (title: string) => void;
}

const isQuestion = (text: string) => /\\?/.test(text);

export const ChatPanel = ({
  messages,
  assistantDraft,
  planSteps,
  onSend,
  onSelectFolder,
  selectedFolder,
  models,
  selectedModel,
  onSelectModel,
  title,
  onTitleChange
}: ChatPanelProps) => {
  const folderLabel = selectedFolder
    ? selectedFolder.split("/").filter(Boolean).pop() ?? selectedFolder
    : "Select folder";
  const [value, setValue] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const titleBarRef = useRef<HTMLDivElement | null>(null);
  const isEmpty = messages.length === 0 && !assistantDraft;
  const quickActions = [
    "Create a file",
    "Organize files",
    "Crunch data",
    "Prep for a meeting",
    "Draft a message",
    "Make a prototype"
  ];

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [value, resizeTextarea]);

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!titleBarRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isMenuOpen]);

  useEffect(() => {
    if (isRenaming) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isRenaming]);

  const handleSend = useCallback(async () => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }
    const sent = await onSend(nextValue);
    if (sent) {
      setValue("");
    }
  }, [onSend, value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
  }, []);

  const commitTitle = useCallback(() => {
    const nextTitle = draftTitle.trim() || "New task";
    onTitleChange(nextTitle);
    setIsRenaming(false);
  }, [draftTitle, onTitleChange]);

  const cancelTitle = useCallback(() => {
    setDraftTitle(title);
    setIsRenaming(false);
  }, [title]);

  return (
    <section className="chat-panel">
      <div className="title-bar" ref={titleBarRef}>
        <div className="title-pill">
          {isRenaming ? (
            <input
              ref={titleInputRef}
              className="title-input"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelTitle();
                }
              }}
              placeholder="New task"
            />
          ) : (
            <span className="title-text">{title}</span>
          )}
          <button
            className="title-menu-button"
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            aria-label="Open title menu"
          >
            v
          </button>
        </div>
        {isMenuOpen && (
          <div className="title-menu">
            <button
              type="button"
              className="title-menu-item"
              onClick={() => {
                setIsRenaming(true);
                setIsMenuOpen(false);
              }}
            >
              Rename
            </button>
            <button type="button" className="title-menu-item danger" disabled>
              Archive
            </button>
          </div>
        )}
      </div>

      <div className="chat-body">
        {isEmpty && (
          <div className="empty-state">
            <div className="empty-badge">Sidekick</div>
            <h3>Let's knock something off your list</h3>
            <p>
              Sidekick runs multi-step tasks against your local workspace. Describe what you need,
              review the plan, and approve any commands or edits.
            </p>
            <div className="empty-actions">
              {quickActions.map((action) => (
                <button key={action} className="ghost-pill" onClick={() => setValue(action)}>
                  {action}
                </button>
              ))}
            </div>
          </div>
        )}

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

        {!isEmpty && (
          <div className="chat-stream">
            {messages.map((message) => {
              const isPrompt = message.role === "assistant" && isQuestion(message.text);
              return (
                <div key={message.id} className={`message ${message.role} ${isPrompt ? "prompt" : ""}`}>
                  <div className="message-meta">
                    <span>{message.role === "user" ? "You" : "Sidekick"}</span>
                    <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {isPrompt && <div className="prompt-label">Needs your input</div>}
                  <p>{message.text}</p>
                </div>
              );
            })}

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
        )}
      </div>

      <div className="composer">
        <div className="composer-row">
          <button className="folder-button" onClick={onSelectFolder} aria-label="Select folder">
            {folderLabel}
          </button>
          <textarea
            placeholder="Reply..."
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            ref={textareaRef}
            rows={1}
          />
          <div className="composer-controls">
            <select value={selectedModel} onChange={(event) => onSelectModel(event.target.value)}>
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <button className="send-button" onClick={handleSend} aria-label="Send">
              ↑
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
