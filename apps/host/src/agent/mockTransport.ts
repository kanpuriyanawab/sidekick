import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import type {
  ApprovalDecision,
  ApprovalRequest,
  TransportEvent
} from "@sidekick/shared-types";
import type { CodexTransport, TransportEventHandler, WorkspaceContext } from "@sidekick/transport-codex-appserver";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockTransport implements CodexTransport {
  private emitter = new EventEmitter();
  private threadToSession = new Map<string, string>();
  private pendingApprovals = new Map<string, { sessionId: string; turnId: string }>();

  async createThread(context: WorkspaceContext): Promise<string> {
    const threadId = `thread_${nanoid(8)}`;
    if (context.sessionId) {
      this.threadToSession.set(threadId, context.sessionId);
    }
    return threadId;
  }

  async sendUserMessage(threadId: string, text: string): Promise<string> {
    const sessionId = this.threadToSession.get(threadId) ?? threadId;
    const turnId = `turn_${nanoid(8)}`;

    void this.simulateResponse(sessionId, turnId, text);
    return turnId;
  }

  async cancel(): Promise<void> {
    return;
  }

  async respondApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      return;
    }
    this.pendingApprovals.delete(approvalId);

    const now = new Date().toISOString();
    if (decision === "deny_once" || decision === "deny_always") {
      this.emitEvent({
        type: "assistant.message",
        sessionId: pending.sessionId,
        turnId: pending.turnId,
        createdAt: now,
        payload: { text: "Understood. I will not run that command." }
      });
      return;
    }

    this.emitEvent({
      type: "tool.started",
      sessionId: pending.sessionId,
      turnId: pending.turnId,
      createdAt: now,
      payload: { name: "shell_command", message: "Running command..." }
    });
    await delay(350);
    this.emitEvent({
      type: "command.stdout",
      sessionId: pending.sessionId,
      turnId: pending.turnId,
      createdAt: new Date().toISOString(),
      payload: { command: "rg --files", data: "src/App.tsx\nsrc/styles.css" }
    });
    await delay(250);
    this.emitEvent({
      type: "command.exit",
      sessionId: pending.sessionId,
      turnId: pending.turnId,
      createdAt: new Date().toISOString(),
      payload: { command: "rg --files", code: 0 }
    });
    await delay(200);
    this.emitEvent({
      type: "assistant.message",
      sessionId: pending.sessionId,
      turnId: pending.turnId,
      createdAt: new Date().toISOString(),
      payload: { text: "Found files and ready to proceed. What would you like to change?" }
    });
  }

  onEvent(handler: TransportEventHandler): () => void {
    this.emitter.on("event", handler);
    return () => this.emitter.off("event", handler);
  }

  private emitEvent(event: TransportEvent): void {
    this.emitter.emit("event", event);
  }

  private async simulateResponse(sessionId: string, turnId: string, text: string): Promise<void> {
    const now = new Date().toISOString();
    this.emitEvent({
      type: "assistant.delta",
      sessionId,
      turnId,
      createdAt: now,
      payload: { text: "Got it. I'll break this down." }
    });

    await delay(200);
    this.emitEvent({
      type: "plan.started",
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      payload: {
        steps: [
          "Review the target workspace and identify relevant files",
          "Propose a safe plan before edits or commands",
          "Request approval for any command execution",
          "Summarize changes and next steps"
        ]
      }
    });

    await delay(350);
    const approvalId = `approval_${nanoid(8)}`;
    const approvalRequest: ApprovalRequest = {
      id: approvalId,
      sessionId,
      turnId,
      kind: "command",
      title: "Approve command?",
      riskLevel: "low",
      details: {
        command: "rg --files",
        cwd: "/Users/you/workspace",
        reason: "List files in workspace"
      },
      status: "pending",
      createdAt: new Date().toISOString(),
      codexApprovalId: approvalId
    };
    this.pendingApprovals.set(approvalId, { sessionId, turnId });
    this.emitEvent({
      type: "approval.request",
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      payload: approvalRequest
    });

    await delay(150);
    this.emitEvent({
      type: "assistant.message",
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      payload: { text: `I am ready to proceed with: ${text}` }
    });
  }
}
