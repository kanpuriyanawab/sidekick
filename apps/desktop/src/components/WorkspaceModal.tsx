import { useState } from "react";

interface WorkspaceModalProps {
  initialName?: string;
  initialPath?: string;
  onSubmit: (input: { name?: string; rootPath: string }) => void;
  onClose: () => void;
}

export const WorkspaceModal = ({ initialName = "", initialPath = "", onSubmit, onClose }: WorkspaceModalProps) => {
  const [name, setName] = useState(initialName);
  const [rootPath, setRootPath] = useState(initialPath);

  const handleSubmit = () => {
    const trimmed = rootPath.trim();
    if (!trimmed) {
      return;
    }
    const nameValue = name.trim();
    onSubmit({ rootPath: trimmed, name: nameValue ? nameValue : undefined });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>New workspace</h2>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <label htmlFor="workspace-name">Name</label>
            <input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Workspace"
            />
          </div>
          <div className="modal-field">
            <label htmlFor="workspace-path">Root path</label>
            <input
              id="workspace-path"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="/Users/you/Projects/MyApp"
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="primary-button" onClick={handleSubmit}>
            Create workspace
          </button>
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
