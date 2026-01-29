import type { TransportEvent } from "@sidekick/shared-types";

interface LogDrawerProps {
  open: boolean;
  onClose: () => void;
  events: TransportEvent[];
}

const formatEvent = (event: TransportEvent): string => {
  const timestamp = new Date(event.createdAt).toLocaleTimeString();

  if (event.type === "assistant.message") {
    return `[${timestamp}] assistant.message ${event.payload.text}`;
  }
  if (event.type === "assistant.delta") {
    return `[${timestamp}] assistant.delta ${event.payload.text}`;
  }
  if (event.type === "approval.request") {
    return `[${timestamp}] approval.request ${event.payload.title}`;
  }
  if (event.type === "item.delta") {
    return `[${timestamp}] item.delta ${event.payload.kind} ${event.payload.delta}`;
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const item = event.payload.item as { type?: string; id?: string } | undefined;
    return `[${timestamp}] ${event.type} ${item?.type ?? "item"} ${item?.id ?? ""}`.trim();
  }
  if (event.type === "command.stdout") {
    return `[${timestamp}] command.stdout ${event.payload.command} ${event.payload.data ?? ""}`.trim();
  }
  if (event.type === "command.stderr") {
    return `[${timestamp}] command.stderr ${event.payload.command} ${event.payload.data ?? ""}`.trim();
  }
  if (event.type === "command.exit") {
    return `[${timestamp}] command.exit ${event.payload.command} ${event.payload.code ?? ""}`.trim();
  }
  if (event.type === "thread.started") {
    return `[${timestamp}] thread.started ${event.payload.threadId}`;
  }
  if (event.type === "turn.started" || event.type === "turn.completed") {
    return `[${timestamp}] ${event.type} ${event.turnId}`;
  }
  if (event.type === "error") {
    return `[${timestamp}] error ${event.payload.message}`;
  }
  return `[${timestamp}] ${event.type} ${JSON.stringify(event.payload)}`;
};

export const LogDrawer = ({ open, onClose, events }: LogDrawerProps) => {
  if (!open) {
    return null;
  }

  const logText = events.map((event) => formatEvent(event)).join("\n");

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <h3>Execution log</h3>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>
        <pre className="drawer-content">{logText || "No events yet."}</pre>
      </aside>
    </div>
  );
};
