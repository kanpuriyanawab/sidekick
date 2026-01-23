import { useState } from "react";

interface SessionModalProps {
  initialTitle?: string;
  onSubmit: (title?: string) => void;
  onClose: () => void;
}

export const SessionModal = ({ initialTitle = "", onSubmit, onClose }: SessionModalProps) => {
  const [title, setTitle] = useState(initialTitle);

  const handleSubmit = () => {
    const trimmed = title.trim();
    onSubmit(trimmed ? trimmed : undefined);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>New session</h2>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <label htmlFor="session-title">Title</label>
            <input
              id="session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Refactor auth module"
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary-button" onClick={handleSubmit}>
            Create session
          </button>
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
