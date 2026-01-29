import type { Session, Workspace } from "@sidekick/shared-types";

interface SidebarProps {
  workspaces: Workspace[];
  sessions: Session[];
  activeWorkspaceId?: string;
  activeSessionId?: string;
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export const Sidebar = ({
  workspaces,
  sessions,
  activeWorkspaceId,
  activeSessionId,
  onSelectWorkspace,
  onSelectSession,
  onNewSession
}: SidebarProps) => {
  return (
    <aside className="sidebar">
      <h1 className="sidebar-title">Sidekick</h1>
      <button className="new-task-button" onClick={onNewSession}>
        <span className="new-task-icon">+</span>
        New task
      </button>

      <div className="sidebar-section">
        <div className="sidebar-row">
          <p className="sidebar-label">Recents</p>
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

      <div className="sidebar-footer">
        <button className="session-indicator" type="button">
          <span className={`pulse-dot ${activeSessionId ? "active" : ""}`} />
          {activeSessionId ? "Session active" : "No session"}
        </button>
      </div>
    </aside>
  );
};
