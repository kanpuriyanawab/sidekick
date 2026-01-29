import { nanoid } from "nanoid";
import type {
  ApprovalDecisionInput,
  ApprovalRequest,
  Session,
  TransportEvent
} from "@sidekick/shared-types";
import type { CodexTransport } from "@sidekick/transport-codex-appserver";
import type { Store } from "../db/store";

const SYSTEM_PROMPT =
  "You are operating within WORKSPACE_ROOT only. Propose a plan before executing. Always request approval before writes or commands.";

export type EventListener = (event: TransportEvent) => void;

export class AgentManager {
  private store: Store;
  private transport: CodexTransport;
  private listeners: Set<EventListener> = new Set();
  private sessionModels = new Map<string, string>();

  constructor(store: Store, transport: CodexTransport) {
    this.store = store;
    this.transport = transport;
    this.transport.onEvent((event) => this.handleTransportEvent(event));
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendMessage(sessionId: string, message: string, model?: string): Promise<string> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (model) {
      this.sessionModels.set(sessionId, model);
    }
    const threadId = await this.ensureThread(session, model);
    const transportTurnId = await this.transport.sendUserMessage(threadId, message);
    const turnId = this.store.createTurn(sessionId, message, transportTurnId);

    this.store.addTimelineItem({
      sessionId,
      turnId,
      type: "message",
      payload: { role: "user", text: message }
    });

    session.status = "running";
    session.updatedAt = new Date().toISOString();
    this.store.updateSession(session);

    return turnId;
  }

  async respondApproval(input: ApprovalDecisionInput): Promise<void> {
    await this.transport.respondApproval(input.approvalId, input.decision, {
      rememberRule: input.rememberRule
    });
    const approval = this.store.getApproval(input.approvalId);
    if (approval) {
      this.store.updateApprovalStatus(
        approval.id,
        input.decision.startsWith("approve") ? "approved" : "denied",
        new Date().toISOString()
      );
    }
  }

  private async ensureThread(session: Session, modelOverride?: string): Promise<string> {
    if (session.codexThreadId) {
      return session.codexThreadId;
    }

    const workspace = this.store.getWorkspace(session.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${session.workspaceId}`);
    }

    const model = modelOverride ?? this.sessionModels.get(session.id);
    const threadId = await this.transport.createThread({
      workspaceRoot: workspace.rootPath,
      workspaceName: workspace.name,
      systemPrompt: SYSTEM_PROMPT,
      sessionId: session.id,
      model
    });

    session.codexThreadId = threadId;
    session.updatedAt = new Date().toISOString();
    this.store.updateSession(session);
    return threadId;
  }

  private handleTransportEvent(event: TransportEvent): void {
    this.store.addTimelineItem({
      sessionId: event.sessionId,
      turnId: "turnId" in event ? event.turnId : undefined,
      type: this.mapEventToTimelineType(event),
      payload: event
    });

    if (event.type === "approval.request") {
      this.store.createApproval({
        ...event.payload,
        id: event.payload.id || `approval_${nanoid(8)}`,
        sessionId: event.sessionId,
        turnId: event.turnId
      } as ApprovalRequest);
    }

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private mapEventToTimelineType(event: TransportEvent): "message" | "tool_call" | "command_output" | "file_change" | "approval_request" | "plan" | "summary" | "error" {
    if (event.type.startsWith("assistant")) {
      return "message";
    }
    if (event.type.startsWith("plan")) {
      return "plan";
    }
    if (event.type.startsWith("tool")) {
      return "tool_call";
    }
    if (event.type.startsWith("command")) {
      return "command_output";
    }
    if (event.type.startsWith("file")) {
      return "file_change";
    }
    if (event.type === "item.delta") {
      if (event.payload.kind === "commandOutput") {
        return "command_output";
      }
      if (event.payload.kind === "agentMessage") {
        return "message";
      }
      return "summary";
    }
    if (event.type === "item.started" || event.type === "item.completed") {
      const itemType = (event.payload.item as { type?: string } | undefined)?.type;
      if (itemType === "commandExecution") {
        return "command_output";
      }
      if (itemType === "fileChange") {
        return "file_change";
      }
      if (itemType === "agentMessage") {
        return "message";
      }
      if (itemType === "reasoning") {
        return "summary";
      }
      return "tool_call";
    }
    if (event.type.startsWith("thread") || event.type.startsWith("turn")) {
      return "tool_call";
    }
    if (event.type === "approval.request") {
      return "approval_request";
    }
    if (event.type === "session.summary") {
      return "summary";
    }
    return "error";
  }
}
