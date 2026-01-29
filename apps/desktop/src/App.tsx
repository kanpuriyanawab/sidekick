import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/api/dialog";
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
import { LogDrawer } from "./components/LogDrawer";

const createMessage = (role: ChatMessage["role"], text: string, timestamp?: string): ChatMessage => ({
  id: `${role}_${Math.random().toString(36).slice(2, 8)}`,
  role,
  text,
  timestamp: timestamp ?? new Date().toISOString()
});

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
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [status, setStatus] = useState("idle");
  const agentDrafts = useRef(new Map<string, string>());
  const [showSessionModal, setShowSessionModal] = useState(false);
  const modelOptions = ["gpt-5.2-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini", "gpt-5.2"];
  const [selectedModel, setSelectedModel] = useState(modelOptions[0]);
  const [showLogDrawer, setShowLogDrawer] = useState(false);
  const [titleDraft, setTitleDraft] = useState("New task");
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces]
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );

  useEffect(() => {
    if (activeSession?.title) {
      setTitleDraft(activeSession.title);
    } else {
      setTitleDraft("New task");
    }
  }, [activeSession?.id, activeSession?.title]);

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
      setActiveSessionId(undefined);
      return;
    }
    let active = true;
    client
      .listSessions(activeWorkspaceId)
      .then((data) => {
        if (!active) return;
        setSessions(data);
        setActiveSessionId((current) => current ?? data[0]?.id);
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

  const handleSelectFolder = useCallback(async (): Promise<string | undefined> => {
    try {
      let folderPath: string | null = null;
      if ((window as unknown as { __TAURI__?: unknown }).__TAURI__) {
        const selection = await openDialog({
          directory: true,
          multiple: false,
          title: "Select working folder"
        });
        folderPath = Array.isArray(selection) ? selection[0] ?? null : (selection as string | null);
      } else {
        alert("Folder picker requires the desktop app.");
      }

      if (!folderPath) {
        return;
      }
      const existing = workspaces.find((workspace) => workspace.rootPath === folderPath);
      if (existing) {
        if (existing.id !== activeWorkspaceId) {
          setActiveWorkspaceId(existing.id);
          setActiveSessionId(undefined);
          setMessages([]);
          setEvents([]);
          setPlanSteps(null);
        }
        return existing.id;
      }
      try {
        const workspace = await client.createWorkspace({ rootPath: folderPath });
        setWorkspaces((prev) => [workspace, ...prev]);
        setActiveWorkspaceId(workspace.id);
        setActiveSessionId(undefined);
        setMessages([]);
        setEvents([]);
        setPlanSteps(null);
        return workspace.id;
      } catch (error) {
        alert(`Failed to set workspace: ${(error as Error).message}`);
        return;
      }
    } catch (error) {
      console.warn("Folder picker unavailable", error);
      return;
    }
  }, [activeWorkspaceId, client, workspaces]);

  const handleSend = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return false;
      }
      let workspaceId = activeWorkspaceId;
      if (!workspaceId) {
        workspaceId = await handleSelectFolder();
      }
      if (!workspaceId) {
        return false;
      }
      let sessionId = activeSessionId;
      if (!sessionId) {
        try {
          const title = trimmed.length > 64 ? `${trimmed.slice(0, 61)}...` : trimmed;
          const session = await client.createSession({ workspaceId, title });
          setSessions((prev) => [session, ...prev]);
          setActiveSessionId(session.id);
          setMessages([]);
          setEvents([]);
          setPlanSteps(null);
          setTitleDraft(session.title);
          sessionId = session.id;
        } catch (error) {
          console.warn("Failed to create session", error);
          return false;
        }
      }
      setMessages((prev) => [...prev, createMessage("user", trimmed)]);
      setStatus("running");
      try {
        await client.sendMessage({ sessionId, message: trimmed, model: selectedModel });
        return true;
      } catch (error) {
        console.warn("Failed to send message", error);
        setStatus("error");
        return false;
      }
    },
    [activeSessionId, activeWorkspaceId, client, handleSelectFolder, selectedModel]
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

  const handleNewSession = useCallback(async () => {
    let workspaceId = activeWorkspaceId;
    if (!workspaceId) {
      workspaceId = await handleSelectFolder();
    }
    if (!workspaceId) {
      return;
    }
    setShowSessionModal(true);
  }, [activeWorkspaceId, handleSelectFolder]);

  const handleCreateSession = useCallback(
    async (title?: string) => {
      if (!activeWorkspaceId) return;
      const session = await client.createSession({ workspaceId: activeWorkspaceId, title });
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
      setEvents([]);
      setPlanSteps(null);
      setTitleDraft(session.title);
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

  const handleTitleChange = useCallback(
    (next: string) => {
      setTitleDraft(next);
      if (!activeSessionId) {
        return;
      }
      setSessions((prev) =>
        prev.map((session) => (session.id === activeSessionId ? { ...session, title: next } : session))
      );
    },
    [activeSessionId]
  );

  return (
    <div className="app-shell">
      <Sidebar
        workspaces={workspaces}
        sessions={sessions}
        activeWorkspaceId={activeWorkspaceId}
        activeSessionId={activeSessionId}
        onSelectWorkspace={handleWorkspaceSelect}
        onSelectSession={handleSessionSelect}
        onNewSession={handleNewSession}
      />

      <ChatPanel
        messages={messages}
        assistantDraft={assistantDraft}
        planSteps={planSteps}
        onSend={handleSend}
        onSelectFolder={handleSelectFolder}
        selectedFolder={activeWorkspace?.rootPath}
        models={modelOptions}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        title={titleDraft}
        onTitleChange={handleTitleChange}
      />

      <TimelinePanel
        events={events}
        status={status}
        sessionTitle={activeSession?.title}
        onOpenLogs={() => setShowLogDrawer(true)}
        workingFolder={activeWorkspace?.rootPath}
      />

      {pendingApproval && (
        <ApprovalModal approval={pendingApproval} onDecision={handleDecision} />
      )}

      {showSessionModal && (
        <SessionModal
          onSubmit={handleCreateSession}
          onClose={() => setShowSessionModal(false)}
        />
      )}

      <LogDrawer
        open={showLogDrawer}
        onClose={() => setShowLogDrawer(false)}
        events={events}
      />
    </div>
  );
};

export default App;
