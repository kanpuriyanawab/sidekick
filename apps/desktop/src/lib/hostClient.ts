import type {
  AgentSendInput,
  ApprovalDecisionInput,
  HostApiConfig,
  Session,
  SessionCreateInput,
  TimelineItem,
  TransportEvent,
  Workspace,
  WorkspaceCreateInput
} from "@sidekick/shared-types";

export interface HostClientAPI {
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: WorkspaceCreateInput): Promise<Workspace>;
  listSessions(workspaceId: string): Promise<Session[]>;
  createSession(input: SessionCreateInput): Promise<Session>;
  listTimeline(sessionId: string): Promise<TimelineItem[]>;
  sendMessage(input: AgentSendInput): Promise<{ turnId: string }>;
  respondApproval(input: ApprovalDecisionInput): Promise<void>;
  connectEvents(handler: (event: TransportEvent) => void): () => void;
}

const defaultConfig: HostApiConfig = {
  baseUrl: import.meta.env.VITE_SIDEKICK_HOST ?? "http://localhost:8787",
  wsUrl: import.meta.env.VITE_SIDEKICK_WS ?? "ws://localhost:8787/events"
};

export const createHostClient = (config: HostApiConfig = defaultConfig): HostClientAPI => {
  const fetchJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Host request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  };

  return {
    listWorkspaces: () => fetchJson(`${config.baseUrl}/workspaces`),
    createWorkspace: (input) =>
      fetchJson(`${config.baseUrl}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      }),
    listSessions: (workspaceId) =>
      fetchJson(`${config.baseUrl}/sessions?workspaceId=${encodeURIComponent(workspaceId)}`),
    createSession: (input) =>
      fetchJson(`${config.baseUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      }),
    listTimeline: (sessionId) =>
      fetchJson(`${config.baseUrl}/timeline?sessionId=${encodeURIComponent(sessionId)}`),
    sendMessage: (input) =>
      fetchJson(`${config.baseUrl}/agent/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      }),
    respondApproval: async (input) => {
      await fetchJson(`${config.baseUrl}/agent/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
    },
    connectEvents: (handler) => {
      const socket = new WebSocket(config.wsUrl);
      socket.onmessage = (message) => {
        try {
          const data = JSON.parse(message.data as string) as {
            type: string;
            payload?: TransportEvent;
          };
          if (data.type === "event" && data.payload) {
            handler(data.payload);
          }
        } catch (error) {
          console.warn("Failed to parse host event", error);
        }
      };
      return () => socket.close();
    }
  };
};
