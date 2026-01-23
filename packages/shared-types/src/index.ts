export type RiskLevel = "low" | "med" | "high";
export type ApprovalKind = "command" | "file_write" | "delete" | "network" | "mcp_tool";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalDecision = "approve_once" | "approve_always" | "deny_once" | "deny_always";

export type SessionStatus = "idle" | "running" | "waiting_approval" | "cancelled" | "error";
export type TimelineItemType =
  | "message"
  | "tool_call"
  | "command_output"
  | "file_change"
  | "approval_request"
  | "plan"
  | "summary"
  | "error";

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  settings: WorkspaceSettings;
  mcpConfig: Integration[];
}

export interface WorkspaceSettings {
  allowNetwork: boolean;
  allowOutsideRoot: boolean;
  preferredShell?: string;
  commandRules: PermissionRule[];
  pathRules: PermissionRule[];
  toolRules: PermissionRule[];
}

export interface PermissionRule {
  id: string;
  pattern: string;
  decision: "allow" | "ask" | "deny";
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  codexThreadId?: string;
  status: SessionStatus;
  summary?: string;
  lastOpenedAt?: string;
}

export interface Turn {
  id: string;
  sessionId: string;
  userMessage: string;
  createdAt: string;
  status: "pending" | "streaming" | "complete" | "error";
}

export interface TimelineItem {
  id: string;
  sessionId: string;
  turnId?: string;
  type: TimelineItemType;
  payload: Record<string, unknown>;
  createdAt: string;
  sequence: number;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  turnId: string;
  kind: ApprovalKind;
  title: string;
  riskLevel: RiskLevel;
  details: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  codexApprovalId?: string;
}

export type ApprovalResponder = (decision: "accept" | "decline") => void;
export type ApprovalRequestWithResponder = ApprovalRequest & { respond?: ApprovalResponder };

export interface Skill {
  id: string;
  workspaceId?: string;
  name: string;
  description: string;
  promptTemplate: string;
  variablesSchema?: Record<string, unknown>;
  enabled: boolean;
}

export interface Hook {
  id: string;
  workspaceId: string;
  event:
    | "session_start"
    | "before_command"
    | "after_command"
    | "before_apply_edits"
    | "after_apply_edits";
  actionType: "append_context" | "run_local_script" | "enforce_policy";
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface Integration {
  id: string;
  workspaceId: string;
  type: "mcp";
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export type TransportEvent =
  | {
      type: "assistant.delta";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { text: string };
    }
  | {
      type: "assistant.message";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { text: string };
    }
  | {
      type: "plan.started" | "plan.updated" | "plan.final";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { steps: string[] };
    }
  | {
      type: "tool.started" | "tool.progress" | "tool.finished";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { name: string; message?: string };
    }
  | {
      type: "command.stdout" | "command.stderr" | "command.exit";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { command: string; data?: string; code?: number };
    }
  | {
      type: "file.diff" | "file.write";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { path: string; diff?: string; hash?: string };
    }
  | {
      type: "approval.request";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: ApprovalRequestWithResponder;
    }
  | {
      type: "thread.started";
      sessionId: string;
      createdAt: string;
      payload: { threadId: string };
    }
  | {
      type: "turn.started" | "turn.completed";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { threadId: string; status?: string; error?: string };
    }
  | {
      type: "item.started" | "item.completed";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { threadId: string; item: Record<string, unknown> };
    }
  | {
      type: "item.delta";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: {
        threadId: string;
        itemId?: string;
        kind: "agentMessage" | "commandOutput" | "reasoningSummary";
        delta: string;
        summaryIndex?: number;
      };
    }
  | {
      type: "error";
      sessionId: string;
      turnId: string;
      createdAt: string;
      payload: { message: string; recoverable: boolean };
    }
  | {
      type: "session.summary";
      sessionId: string;
      createdAt: string;
      payload: { summary: string };
    };

export interface WorkspaceCreateInput {
  rootPath: string;
  name?: string;
}

export interface SessionCreateInput {
  workspaceId: string;
  title?: string;
}

export interface AgentSendInput {
  sessionId: string;
  message: string;
  attachments?: string[];
}

export interface ApprovalDecisionInput {
  sessionId: string;
  approvalId: string;
  decision: ApprovalDecision;
  rememberRule?: boolean;
}

export interface HostApiConfig {
  baseUrl: string;
  wsUrl: string;
}
