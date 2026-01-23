import type { TransportEvent } from "@sidekick/shared-types";

const itemTypeFor = (event: TransportEvent): string | undefined => {
  if (event.type === "item.started" || event.type === "item.completed") {
    const item = event.payload.item as { type?: string } | undefined;
    return item?.type;
  }
  return undefined;
};

const eventCategory = (event: TransportEvent): string => {
  if (event.type.startsWith("assistant")) return "messages";
  if (event.type.startsWith("plan")) return "plans";
  if (event.type.startsWith("tool")) return "tools";
  if (event.type.startsWith("command")) return "commands";
  if (event.type.startsWith("file")) return "files";
  if (event.type === "approval.request") return "approvals";
  if (event.type === "error") return "errors";
  if (event.type === "item.delta") {
    if (event.payload.kind === "agentMessage") return "messages";
    if (event.payload.kind === "commandOutput") return "commands";
    if (event.payload.kind === "reasoningSummary") return "plans";
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const itemType = itemTypeFor(event);
    if (itemType === "agentMessage") return "messages";
    if (itemType === "commandExecution") return "commands";
    if (itemType === "fileChange") return "files";
    if (itemType === "reasoning") return "plans";
    return "tools";
  }
  if (event.type.startsWith("thread") || event.type.startsWith("turn")) return "tools";
  return "other";
};

const truncate = (value: string, limit = 120): string => {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
};

const previewText = (event: TransportEvent): string => {
  if (event.type === "assistant.message" || event.type === "assistant.delta") {
    return event.payload.text;
  }
  if (event.type.startsWith("plan")) {
    return `${event.payload.steps.length} steps`;
  }
  if (event.type === "thread.started") {
    return `Thread ${event.payload.threadId}`;
  }
  if (event.type === "turn.started") {
    return `Turn ${event.turnId} started`;
  }
  if (event.type === "turn.completed") {
    return `Turn ${event.turnId} ${event.payload.status ?? "completed"}`;
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const item = event.payload.item as { type?: string; command?: string; path?: string } | undefined;
    const itemType = item?.type ?? "item";
    if (itemType === "commandExecution" && item?.command) {
      return truncate(item.command);
    }
    if (itemType === "fileChange" && item?.path) {
      return item.path;
    }
    return itemType;
  }
  if (event.type === "item.delta") {
    return truncate(event.payload.delta);
  }
  if (event.type.startsWith("command")) {
    return event.payload.command;
  }
  if (event.type === "approval.request") {
    return event.payload.title;
  }
  if (event.type.startsWith("tool")) {
    return event.payload.name;
  }
  return event.type;
};

interface TimelinePanelProps {
  events: TransportEvent[];
  filters: Record<string, boolean>;
  onToggleFilter: (key: string) => void;
  selectedEvent?: TransportEvent;
  onSelectEvent: (event: TransportEvent) => void;
}

export const TimelinePanel = ({
  events,
  filters,
  onToggleFilter,
  selectedEvent,
  onSelectEvent
}: TimelinePanelProps) => {
  const filtered = events.filter((event) => filters[eventCategory(event)]);

  return (
    <aside className="timeline-panel">
      <header className="timeline-header">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>Timeline</h2>
        </div>
      </header>

      <div className="filter-chips">
        {Object.keys(filters).map((key) => (
          <button
            key={key}
            className={`chip ${filters[key] ? "active" : ""}`}
            onClick={() => onToggleFilter(key)}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="timeline-list">
        {filtered.length === 0 && <p className="muted">No events yet.</p>}
        {filtered.map((event, index) => (
          <button
            key={`${event.type}-${event.createdAt}-${index}`}
            className={`timeline-item ${selectedEvent === event ? "active" : ""}`}
            onClick={() => onSelectEvent(event)}
          >
            <div className="timeline-type">{event.type}</div>
            <div className="timeline-preview">{previewText(event)}</div>
            <div className="timeline-time">{new Date(event.createdAt).toLocaleTimeString()}</div>
          </button>
        ))}
      </div>

      {selectedEvent && (
        <div className="timeline-detail">
          <h3>Event Detail</h3>
          <pre>{JSON.stringify(selectedEvent, null, 2)}</pre>
        </div>
      )}
    </aside>
  );
};
