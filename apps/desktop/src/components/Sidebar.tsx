import type { Session, Workspace } from "@sidekick/shared-types";

interface SidebarProps {
  workspaces: Workspace[];
  sessions: Session[];
  activeWorkspaceId?: string;
  activeSessionId?: string;
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (id: string) => void;
  onNewWorkspace: () => void;
  onNewSession: () => void;
}

export const Sidebar = ({
  workspaces,
  sessions,
  activeWorkspaceId,
  activeSessionId,
  onSelectWorkspace,
  onSelectSession,
  onNewWorkspace,
  onNewSession
}: SidebarProps) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <p className="eyebrow">Workspaces</p>
          <h1>Sidekick</h1>
        </div>
        <button className="ghost-button" onClick={onNewWorkspace}>
          New
        </button>
      </div>

      <div className="workspace-list">
        {workspaces.length === 0 && <p className="muted">No workspaces yet.</p>}
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            className={`workspace-card ${workspace.id === activeWorkspaceId ? "active" : ""}`}
            onClick={() => onSelectWorkspace(workspace.id)}
          >
            <div>
              <div className="workspace-name">{workspace.name}</div>
              <div className="workspace-path">{workspace.rootPath}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-row">
          <h2>Sessions</h2>
          <button className="ghost-button" onClick={onNewSession}>
            New
          </button>
        </div>
        <div className="session-list">
          {sessions.length === 0 && <p className="muted">No sessions yet.</p>}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`session-card ${session.id === activeSessionId ? "active" : ""}`}
              onClick={() => onSelectSession(session.id)}
            >
              <div className="session-title">{session.title}</div>
              <div className="session-meta">{new Date(session.createdAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};
