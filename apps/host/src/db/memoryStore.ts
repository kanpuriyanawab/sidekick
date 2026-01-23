import path from "path";
import { nanoid } from "nanoid";
import type {
  ApprovalRequest,
  ApprovalStatus,
  Session,
  SessionCreateInput,
  TimelineItem,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceSettings
} from "@sidekick/shared-types";
import { defaultWorkspaceSettings } from "../policy";
import type { Store } from "./store";

interface TurnRow {
  id: string;
  sessionId: string;
  userMessage: string;
  createdAt: string;
  status: "pending" | "streaming" | "complete" | "error";
}

export class MemoryStore implements Store {
  private workspaces = new Map<string, Workspace>();
  private sessions = new Map<string, Session>();
  private turns = new Map<string, TurnRow>();
  private timeline = new Map<string, TimelineItem[]>();
  private approvals = new Map<string, ApprovalRequest>();
  private sequences = new Map<string, number>();

  createWorkspace(input: WorkspaceCreateInput): Workspace {
    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: `ws_${nanoid(8)}`,
      name: input.name ?? path.basename(input.rootPath),
      rootPath: input.rootPath,
      createdAt: now,
      updatedAt: now,
      settings: defaultWorkspaceSettings(),
      mcpConfig: []
    };
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  listWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  getWorkspace(id: string): Workspace | null {
    return this.workspaces.get(id) ?? null;
  }

  updateWorkspaceSettings(id: string, settings: WorkspaceSettings): Workspace | null {
    const existing = this.workspaces.get(id);
    if (!existing) {
      return null;
    }
    const updated: Workspace = {
      ...existing,
      settings,
      updatedAt: new Date().toISOString()
    };
    this.workspaces.set(id, updated);
    return updated;
  }

  createSession(input: SessionCreateInput): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: `sess_${nanoid(8)}`,
      workspaceId: input.workspaceId,
      title: input.title ?? "New Session",
      createdAt: now,
      updatedAt: now,
      status: "idle"
    };
    this.sessions.set(session.id, session);
    return session;
  }

  listSessions(workspaceId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSession(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  updateSession(session: Session): void {
    this.sessions.set(session.id, session);
  }

  createTurn(sessionId: string, userMessage: string, turnId?: string): string {
    const now = new Date().toISOString();
    const id = turnId ?? `turn_${nanoid(8)}`;
    this.turns.set(id, {
      id,
      sessionId,
      userMessage,
      createdAt: now,
      status: "streaming"
    });
    return id;
  }

  updateTurnStatus(turnId: string, status: "pending" | "streaming" | "complete" | "error"): void {
    const turn = this.turns.get(turnId);
    if (!turn) {
      return;
    }
    turn.status = status;
    this.turns.set(turnId, turn);
  }

  listTimelineItems(sessionId: string): TimelineItem[] {
    return this.timeline.get(sessionId) ?? [];
  }

  addTimelineItem(
    item: Omit<TimelineItem, "id" | "sequence" | "createdAt"> & { createdAt?: string }
  ): TimelineItem {
    const createdAt = item.createdAt ?? new Date().toISOString();
    const nextSequence = (this.sequences.get(item.sessionId) ?? 0) + 1;
    this.sequences.set(item.sessionId, nextSequence);

    const timelineItem: TimelineItem = {
      ...item,
      id: `evt_${nanoid(8)}`,
      createdAt,
      sequence: nextSequence
    };

    const items = this.timeline.get(item.sessionId) ?? [];
    items.push(timelineItem);
    this.timeline.set(item.sessionId, items);
    return timelineItem;
  }

  createApproval(request: ApprovalRequest): ApprovalRequest {
    this.approvals.set(request.id, request);
    return request;
  }

  updateApprovalStatus(id: string, status: ApprovalStatus, resolvedAt?: string): void {
    const approval = this.approvals.get(id);
    if (!approval) {
      return;
    }
    approval.status = status;
    approval.resolvedAt = resolvedAt;
    this.approvals.set(id, approval);
  }

  getApproval(id: string): ApprovalRequest | null {
    return this.approvals.get(id) ?? null;
  }
}
