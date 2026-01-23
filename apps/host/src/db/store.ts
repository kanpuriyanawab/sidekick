import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
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

export interface Store {
  createWorkspace(input: WorkspaceCreateInput): Workspace;
  listWorkspaces(): Workspace[];
  getWorkspace(id: string): Workspace | null;
  updateWorkspaceSettings(id: string, settings: WorkspaceSettings): Workspace | null;
  createSession(input: SessionCreateInput): Session;
  listSessions(workspaceId: string): Session[];
  getSession(id: string): Session | null;
  updateSession(session: Session): void;
  createTurn(sessionId: string, userMessage: string, turnId?: string): string;
  updateTurnStatus(turnId: string, status: "pending" | "streaming" | "complete" | "error"): void;
  listTimelineItems(sessionId: string): TimelineItem[];
  addTimelineItem(
    item: Omit<TimelineItem, "id" | "sequence" | "createdAt"> & { createdAt?: string }
  ): TimelineItem;
  createApproval(request: ApprovalRequest): ApprovalRequest;
  updateApprovalStatus(id: string, status: ApprovalStatus, resolvedAt?: string): void;
  getApproval(id: string): ApprovalRequest | null;
}

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = wal");
    this.migrate();
  }

  private migrate(): void {
    const migrationPath = path.resolve(process.cwd(), "migrations", "001_init.sql");
    const migrationId = "001_init";
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);"
    );
    const existing = this.db
      .prepare("SELECT id FROM migrations WHERE id = ?")
      .get(migrationId) as { id?: string } | undefined;
    if (existing?.id) {
      return;
    }
    const sql = fs.readFileSync(migrationPath, "utf8");
    this.db.exec(sql);
    this.db
      .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
      .run(migrationId, new Date().toISOString());
  }

  createWorkspace(input: WorkspaceCreateInput): Workspace {
    const now = new Date().toISOString();
    const settings = defaultWorkspaceSettings();
    const workspace: Workspace = {
      id: `ws_${nanoid(8)}`,
      name: input.name ?? path.basename(input.rootPath),
      rootPath: input.rootPath,
      createdAt: now,
      updatedAt: now,
      settings,
      mcpConfig: []
    };

    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, root_path, created_at, updated_at, settings_json, mcp_config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workspace.id,
        workspace.name,
        workspace.rootPath,
        workspace.createdAt,
        workspace.updatedAt,
        JSON.stringify(workspace.settings),
        JSON.stringify(workspace.mcpConfig)
      );

    return workspace;
  }

  listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare("SELECT * FROM workspaces ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToWorkspace(row));
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToWorkspace(row) : null;
  }

  updateWorkspaceSettings(id: string, settings: WorkspaceSettings): Workspace | null {
    const updatedAt = new Date().toISOString();
    const stmt = this.db.prepare(
      "UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?"
    );
    const result = stmt.run(JSON.stringify(settings), updatedAt, id);
    if (result.changes === 0) {
      return null;
    }
    return this.getWorkspace(id);
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

    this.db
      .prepare(
        `INSERT INTO sessions (id, workspace_id, title, created_at, updated_at, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.workspaceId,
        session.title,
        session.createdAt,
        session.updatedAt,
        session.status
      );

    return session;
  }

  listSessions(workspaceId: string): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToSession(row));
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSession(row) : null;
  }

  updateSession(session: Session): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET title = ?, updated_at = ?, codex_thread_id = ?, status = ?, summary = ?, last_opened_at = ?
         WHERE id = ?`
      )
      .run(
        session.title,
        session.updatedAt,
        session.codexThreadId ?? null,
        session.status,
        session.summary ?? null,
        session.lastOpenedAt ?? null,
        session.id
      );
  }

  createTurn(sessionId: string, userMessage: string, turnId?: string): string {
    const now = new Date().toISOString();
    const id = turnId ?? `turn_${nanoid(8)}`;
    this.db
      .prepare("INSERT INTO turns (id, session_id, user_message, created_at, status) VALUES (?, ?, ?, ?, ?)")
      .run(id, sessionId, userMessage, now, "streaming");
    return id;
  }

  updateTurnStatus(turnId: string, status: "pending" | "streaming" | "complete" | "error"): void {
    this.db.prepare("UPDATE turns SET status = ? WHERE id = ?").run(status, turnId);
  }

  listTimelineItems(sessionId: string): TimelineItem[] {
    const rows = this.db
      .prepare("SELECT * FROM timeline_items WHERE session_id = ? ORDER BY sequence ASC")
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToTimelineItem(row));
  }

  addTimelineItem(item: Omit<TimelineItem, "id" | "sequence" | "createdAt"> & { createdAt?: string }): TimelineItem {
    const createdAt = item.createdAt ?? new Date().toISOString();
    const sequence = this.nextSequence(item.sessionId);
    const timeline: TimelineItem = {
      ...item,
      id: `evt_${nanoid(8)}`,
      createdAt,
      sequence
    };

    this.db
      .prepare(
        `INSERT INTO timeline_items (id, session_id, turn_id, type, payload_json, created_at, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        timeline.id,
        timeline.sessionId,
        timeline.turnId ?? null,
        timeline.type,
        JSON.stringify(timeline.payload),
        timeline.createdAt,
        timeline.sequence
      );

    return timeline;
  }

  createApproval(request: ApprovalRequest): ApprovalRequest {
    this.db
      .prepare(
        `INSERT INTO approvals
        (id, session_id, turn_id, kind, title, risk_level, details_json, status, created_at, resolved_at, codex_approval_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.id,
        request.sessionId,
        request.turnId,
        request.kind,
        request.title,
        request.riskLevel,
        JSON.stringify(request.details),
        request.status,
        request.createdAt,
        request.resolvedAt ?? null,
        request.codexApprovalId ?? null
      );

    return request;
  }

  updateApprovalStatus(id: string, status: ApprovalStatus, resolvedAt?: string): void {
    this.db
      .prepare("UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?")
      .run(status, resolvedAt ?? null, id);
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToApproval(row) : null;
  }

  private nextSequence(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 as next FROM timeline_items WHERE session_id = ?")
      .get(sessionId) as { next: number };
    return row.next;
  }

  private rowToWorkspace(row: Record<string, unknown>): Workspace {
    return {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      settings: JSON.parse(String(row.settings_json)),
      mcpConfig: JSON.parse(String(row.mcp_config_json))
    };
  }

  private rowToSession(row: Record<string, unknown>): Session {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      title: String(row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      codexThreadId: row.codex_thread_id ? String(row.codex_thread_id) : undefined,
      status: row.status as Session["status"],
      summary: row.summary ? String(row.summary) : undefined,
      lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : undefined
    };
  }

  private rowToTimelineItem(row: Record<string, unknown>): TimelineItem {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      turnId: row.turn_id ? String(row.turn_id) : undefined,
      type: row.type as TimelineItem["type"],
      payload: JSON.parse(String(row.payload_json)),
      createdAt: String(row.created_at),
      sequence: Number(row.sequence)
    };
  }

  private rowToApproval(row: Record<string, unknown>): ApprovalRequest {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      turnId: String(row.turn_id),
      kind: row.kind as ApprovalRequest["kind"],
      title: String(row.title),
      riskLevel: row.risk_level as ApprovalRequest["riskLevel"],
      details: JSON.parse(String(row.details_json)),
      status: row.status as ApprovalRequest["status"],
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
      codexApprovalId: row.codex_approval_id ? String(row.codex_approval_id) : undefined
    };
  }
}
