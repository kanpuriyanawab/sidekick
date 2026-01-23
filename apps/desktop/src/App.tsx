import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApprovalDecision,
  ApprovalRequest,
  Session,
  TransportEvent,
  Workspace
} from "@sidekick/shared-types";
import { createClient } from "./lib/client";
import { ApprovalModal } from "./components/ApprovalModal";
import { ChatPanel, type ChatMessage } from "./components/ChatPanel";
import { SessionModal } from "./components/SessionModal";
import { Sidebar } from "./components/Sidebar";
import { TimelinePanel } from "./components/TimelinePanel";
import { WorkspaceModal } from "./components/WorkspaceModal";

const createMessage = (role: ChatMessage["role"], text: string, timestamp?: string): ChatMessage => ({
  id: `${role}_${Math.random().toString(36).slice(2, 8)}`,
  role,
  text,
  timestamp: timestamp ?? new Date().toISOString()
});

const defaultFilters: Record<string, boolean> = {
  messages: true,
  plans: true,
  tools: true,
  commands: true,
  files: true,
  approvals: true,
  errors: true
};

const App = () => {
  const client = useMemo(() => createClient(), []);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>();
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantDraft, setAssistantDraft] = useState<string>("");
  const [planSteps, setPlanSteps] = useState<string[] | null>(null);
  const [events, setEvents] = useState<TransportEvent[]>([]);
  const [filters, setFilters] = useState<Record<string, boolean>>(defaultFilters);
  const [selectedEvent, setSelectedEvent] = useState<TransportEvent | undefined>();
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [status, setStatus] = useState("idle");
  const agentDrafts = useRef(new Map<string, string>());
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);

  useEffect(() => {
    let active = true;
    client
      .listWorkspaces()
      .then((data) => {
        if (!active) return;
        setWorkspaces(data);
        if (data[0]) {
          setActiveWorkspaceId(data[0].id);
        }
      })
      .catch(() => {
        if (!active) return;
        setWorkspaces([]);
      });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setSessions([]);
      return;
    }
    let active = true;
    client
      .listSessions(activeWorkspaceId)
      .then((data) => {
        if (!active) return;
        setSessions(data);
        if (data[0]) {
          setActiveSessionId(data[0].id);
        }
      })
      .catch(() => {
        if (!active) return;
        setSessions([]);
      });
    return () => {
      active = false;
    };
  }, [activeWorkspaceId, client]);

  useEffect(() => {
    const disconnect = client.connectEvents((event) => {
      if (activeSessionId && event.sessionId !== activeSessionId) {
        return;
      }
      setEvents((prev) => [...prev, event]);
      if (event.type === "assistant.delta") {
        setAssistantDraft(event.payload.text);
      }
      if (event.type === "assistant.message") {
        setMessages((prev) => [...prev, createMessage("assistant", event.payload.text, event.createdAt)]);
        setAssistantDraft("");
        setStatus("idle");
      }
      if (event.type === "item.started") {
        const item = event.payload.item as { id?: string; type?: string } | undefined;
        const isMessage = item?.type === "agentMessage" || item?.type === "assistantMessage";
        if (isMessage && item.id) {
          agentDrafts.current.set(item.id, "");
        }
      }
      if (event.type === "item.delta" && event.payload.kind === "agentMessage") {
        const itemId = event.payload.itemId ?? "agent-message";
        const current = agentDrafts.current.get(itemId) ?? "";
        const next = current + event.payload.delta;
        agentDrafts.current.set(itemId, next);
        setAssistantDraft(next);
      }
      if (event.type === "item.completed") {
        const item = event.payload.item as {
          id?: string;
          type?: string;
          text?: string;
        } | undefined;
        const isMessage =
          item?.type === "agentMessage" || item?.type === "assistantMessage" || typeof item?.text === "string";
        if (isMessage) {
          const buffered = item.id ? agentDrafts.current.get(item.id) ?? "" : "";
          const text = item.text ?? buffered;
          if (text.trim().length > 0) {
            setMessages((prev) => [...prev, createMessage("assistant", text, event.createdAt)]);
          }
          if (item.id) {
            agentDrafts.current.delete(item.id);
          }
          setAssistantDraft("");
          setStatus("idle");
        }
      }
      if (event.type === "turn.completed") {
        setStatus("idle");
        setAssistantDraft("");
      }
      if (event.type.startsWith("plan")) {
        setPlanSteps(event.payload.steps);
      }
      if (event.type === "approval.request") {
        setPendingApproval(event.payload);
        setStatus("waiting_approval");
      }
      if (event.type === "error") {
        setStatus("error");
      }
    });
    return () => disconnect();
  }, [activeSessionId, client]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!activeSessionId) {
        return;
      }
      setMessages((prev) => [...prev, createMessage("user", text)]);
      setStatus("running");
      await client.sendMessage({ sessionId: activeSessionId, message: text });
    },
    [activeSessionId, client]
  );

  const handleDecision = useCallback(
    async (decision: ApprovalDecision) => {
      if (!pendingApproval || !activeSessionId) {
        return;
      }
      await client.respondApproval({
        sessionId: activeSessionId,
        approvalId: pendingApproval.id,
        decision,
        rememberRule: decision.endsWith("_always")
      });
      setPendingApproval(null);
      setStatus(decision.toString().startsWith("deny") ? "idle" : "running");
    },
    [activeSessionId, client, pendingApproval]
  );

  const handleNewWorkspace = useCallback(() => {
    setShowWorkspaceModal(true);
  }, []);

  const handleCreateWorkspace = useCallback(
    async (input: { name?: string; rootPath: string }) => {
      const workspace = await client.createWorkspace(input);
      setWorkspaces((prev) => [workspace, ...prev]);
      setActiveWorkspaceId(workspace.id);
      setShowWorkspaceModal(false);
    },
    [client]
  );

  const handleNewSession = useCallback(() => {
    if (!activeWorkspaceId) return;
    setShowSessionModal(true);
  }, [activeWorkspaceId]);

  const handleCreateSession = useCallback(
    async (title?: string) => {
      if (!activeWorkspaceId) return;
      const session = await client.createSession({ workspaceId: activeWorkspaceId, title });
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
      setEvents([]);
      setPlanSteps(null);
      setShowSessionModal(false);
    },
    [activeWorkspaceId, client]
  );

  const handleWorkspaceSelect = useCallback((id: string) => {
    setActiveWorkspaceId(id);
    setActiveSessionId(undefined);
    setMessages([]);
    setEvents([]);
    setPlanSteps(null);
  }, []);

  const handleSessionSelect = useCallback((id: string) => {
    setActiveSessionId(id);
    setMessages([]);
    setEvents([]);
    setPlanSteps(null);
  }, []);

  const toggleFilter = useCallback((key: string) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        workspaces={workspaces}
        sessions={sessions}
        activeWorkspaceId={activeWorkspaceId}
        activeSessionId={activeSessionId}
        onSelectWorkspace={handleWorkspaceSelect}
        onSelectSession={handleSessionSelect}
        onNewWorkspace={handleNewWorkspace}
        onNewSession={handleNewSession}
      />

      <ChatPanel
        messages={messages}
        assistantDraft={assistantDraft}
        planSteps={planSteps}
        status={status}
        onSend={handleSend}
      />

      <TimelinePanel
        events={events}
        filters={filters}
        onToggleFilter={toggleFilter}
        selectedEvent={selectedEvent}
        onSelectEvent={setSelectedEvent}
      />

      <footer className="status-bar">
        <div className="status-left">
          <span className="status-dot" />
          <span>Session: {activeSessionId ? "Active" : "No session"}</span>
        </div>
        <div className="status-right">
          <span>Scope: Workspace only</span>
        </div>
      </footer>

      {pendingApproval && (
        <ApprovalModal approval={pendingApproval} onDecision={handleDecision} />
      )}

      {showWorkspaceModal && (
        <WorkspaceModal
          onSubmit={handleCreateWorkspace}
          onClose={() => setShowWorkspaceModal(false)}
        />
      )}

      {showSessionModal && (
        <SessionModal
          onSubmit={handleCreateSession}
          onClose={() => setShowSessionModal(false)}
        />
      )}
    </div>
  );
};

export default App;
