import type {
  AgentSendInput,
  ApprovalDecisionInput,
  ApprovalRequest,
  Session,
  SessionCreateInput,
  TimelineItem,
  TransportEvent,
  Workspace,
  WorkspaceCreateInput
} from "@sidekick/shared-types";
import type { HostClientAPI } from "./hostClient";

const createId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

export const createMockClient = (): HostClientAPI => {
  const listeners = new Set<(event: TransportEvent) => void>();
  const workspaces: Workspace[] = [];
  const sessions: Session[] = [];
  const timeline: Record<string, TimelineItem[]> = {};

  const emit = (event: TransportEvent) => {
    addTimelineItem(event.sessionId, event);
    listeners.forEach((listener) => listener(event));
  };

  const addTimelineItem = (sessionId: string, event: TransportEvent) => {
    const items = timeline[sessionId] ?? [];
    items.push({
      id: createId("evt"),
      sessionId,
      turnId: "turnId" in event ? event.turnId : undefined,
      type: "message",
      payload: event,
      createdAt: event.createdAt,
      sequence: items.length + 1
    });
    timeline[sessionId] = items;
  };

  const simulate = async (sessionId: string, turnId: string, text: string) => {
    const now = new Date().toISOString();
    emit({
      type: "assistant.delta",
      sessionId,
      turnId,
      createdAt: now,
      payload: { text: "Understood. I'll map a safe plan." }
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    emit({
      type: "plan.started",
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      payload: {
        steps: [
          "Inspect workspace structure and identify key files",
          "Outline steps and ask for approvals",
          "Execute commands and summarize changes"
        ]
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    const approvalId = createId("approval");
    const approvalRequest: ApprovalRequest = {
      id: approvalId,
      sessionId,
      turnId,
      kind: "command",
      title: "Approve command?",
      riskLevel: "low",
      details: { command: "rg --files", cwd: "/Users/you/workspace" },
      status: "pending",
      createdAt: new Date().toISOString(),
      codexApprovalId: approvalId
    };
    emit({
      type: "approval.request",
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      payload: approvalRequest
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    emit({
      type: "assistant.message",
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      payload: { text: `I am ready to proceed with: ${text}` }
    });
  };

  return {
    listWorkspaces: async () => workspaces,
    createWorkspace: async (input: WorkspaceCreateInput) => {
      const now = new Date().toISOString();
      const workspace: Workspace = {
        id: createId("ws"),
        name: input.name ?? "Sidekick Workspace",
        rootPath: input.rootPath,
        createdAt: now,
        updatedAt: now,
        settings: {
          allowNetwork: false,
          allowOutsideRoot: false,
          commandRules: [],
          pathRules: [],
          toolRules: []
        },
        mcpConfig: []
      };
      workspaces.unshift(workspace);
      return workspace;
    },
    listSessions: async (workspaceId: string) => sessions.filter((session) => session.workspaceId === workspaceId),
    createSession: async (input: SessionCreateInput) => {
      const now = new Date().toISOString();
      const session: Session = {
        id: createId("sess"),
        workspaceId: input.workspaceId,
        title: input.title ?? "New Session",
        createdAt: now,
        updatedAt: now,
        status: "idle"
      };
      sessions.unshift(session);
      timeline[session.id] = [];
      return session;
    },
    listTimeline: async (sessionId: string) => timeline[sessionId] ?? [],
    sendMessage: async (input: AgentSendInput) => {
      const turnId = createId("turn");
      simulate(input.sessionId, turnId, input.message);
      return { turnId };
    },
    respondApproval: async (input: ApprovalDecisionInput) => {
      if (input.decision.startsWith("deny")) {
        emit({
          type: "assistant.message",
          sessionId: input.sessionId,
          turnId: createId("turn"),
          createdAt: new Date().toISOString(),
          payload: { text: "Okay, I will not run that command." }
        });
        return;
      }
      emit({
        type: "tool.started",
        sessionId: input.sessionId,
        turnId: createId("turn"),
        createdAt: new Date().toISOString(),
        payload: { name: "shell_command" }
      });
      emit({
        type: "command.stdout",
        sessionId: input.sessionId,
        turnId: createId("turn"),
        createdAt: new Date().toISOString(),
        payload: { command: "rg --files", data: "src/App.tsx\nsrc/styles.css" }
      });
      emit({
        type: "command.exit",
        sessionId: input.sessionId,
        turnId: createId("turn"),
        createdAt: new Date().toISOString(),
        payload: { command: "rg --files", code: 0 }
      });
    },
    connectEvents: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }
  };
};
