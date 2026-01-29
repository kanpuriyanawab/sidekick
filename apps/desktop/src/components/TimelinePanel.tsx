import { useState } from "react";
import type { TransportEvent } from "@sidekick/shared-types";

interface TimelinePanelProps {
  events: TransportEvent[];
  status: string;
  sessionTitle?: string;
  onOpenLogs: () => void;
  workingFolder?: string;
}

export const TimelinePanel = ({
  events,
  status,
  sessionTitle,
  onOpenLogs,
  workingFolder
}: TimelinePanelProps) => {
  const folderLabel = workingFolder
    ? workingFolder.split("/").filter(Boolean).pop() ?? workingFolder
    : "No folder selected";
  const [collapsed, setCollapsed] = useState({
    progress: false,
    workingFolder: false,
    context: false
  });

  const toggle = (key: keyof typeof collapsed) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  return (
    <aside className="timeline-panel">
      <div className="side-cards">
        <div className="side-card">
          <div className="side-card-header">
            <h3>Progress</h3>
            <div className="side-card-actions">
              <span className="status-pill">{status}</span>
              <button
                type="button"
                className="collapse-button"
                onClick={() => toggle("progress")}
                aria-expanded={!collapsed.progress}
              >
                {collapsed.progress ? ">" : "v"}
              </button>
            </div>
          </div>
          {!collapsed.progress && (
            <>
              <div className="progress-dots">
                <span />
                <span />
                <span />
              </div>
              <p className="muted">See task progress for longer tasks.</p>
              <button className="ghost-button" onClick={onOpenLogs}>
                View logs
              </button>
            </>
          )}
        </div>

        <div className="side-card">
          <div className="side-card-header">
            <h3>Working folder</h3>
            <button
              type="button"
              className="collapse-button"
              onClick={() => toggle("workingFolder")}
              aria-expanded={!collapsed.workingFolder}
            >
              {collapsed.workingFolder ? ">" : "v"}
            </button>
          </div>
          {!collapsed.workingFolder && <p className="muted">{folderLabel}</p>}
        </div>

        <div className="side-card">
          <div className="side-card-header">
            <h3>Context</h3>
            <button
              type="button"
              className="collapse-button"
              onClick={() => toggle("context")}
              aria-expanded={!collapsed.context}
            >
              {collapsed.context ? ">" : "v"}
            </button>
          </div>
          {!collapsed.context && (
            <>
              <p className="muted">Track tools and referenced files used in this task.</p>
              <p className="muted">
                {sessionTitle ? `${sessionTitle} · ${events.length} events` : `${events.length} events`}
              </p>
            </>
          )}
        </div>
      </div>
    </aside>
  );
};
