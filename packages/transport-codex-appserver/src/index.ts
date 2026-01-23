import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import readline from "node:readline";
import type {
  ApprovalDecision,
  ApprovalRequestWithResponder,
  TransportEvent
} from "@sidekick/shared-types";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface WorkspaceContext {
  workspaceRoot: string;
  workspaceName?: string;
  systemPrompt?: string;
  sessionId?: string;
}

export interface TransportEventHandler {
  (event: TransportEvent): void;
}

export interface CodexTransport {
  createThread(context: WorkspaceContext): Promise<string>;
  sendUserMessage(threadId: string, text: string, attachments?: string[]): Promise<string>;
  cancel(targetId: string): Promise<void>;
  respondApproval(
    approvalId: string,
    decision: ApprovalDecision,
    options?: { rememberRule?: boolean }
  ): Promise<void>;
  onEvent(handler: TransportEventHandler): () => void;
  shutdown?(): Promise<void>;
}

export interface CodexTransportOptions {
  bin?: string;
  model?: string;
  sandbox?: SandboxMode;
  approvalPolicy?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  method: string;
}

interface ThreadContext {
  sessionId: string;
  cwd: string;
}

export class CodexAppServerTransport implements CodexTransport {
  private proc: ChildProcessByStdio<Writable, Readable, null>;
  private rl: readline.Interface;
  private listeners = new Set<TransportEventHandler>();
  private pendingRequests = new Map<number, PendingRequest>();
  private pendingApprovals = new Map<string, { respond: (decision: "accept" | "decline") => void }>();
  private threadContexts = new Map<string, ThreadContext>();
  private turnToThread = new Map<string, string>();
  private pendingThreadNotifications = new Set<string>();
  private pendingNotificationApprovals = new Map<string, { method: string; params: any }>();
  private agentMessageBuffers = new Map<string, string>();
  private seenThreads = new Set<string>();
  private commandExecutions = new Map<
    string,
    { threadId?: string; turnId?: string; command?: string; cwd?: string }
  >();
  private logStream?: fs.WriteStream;
  private logPath?: string;
  private nextId = 1;
  private initRequestId: number | null = null;
  private ready: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private model: string;
  private sandbox: SandboxMode;
  private approvalPolicy: string;

  constructor(options: CodexTransportOptions = {}) {
    this.model = options.model ?? "gpt-5.1-codex";
    this.sandbox = options.sandbox ?? "workspace-write";
    this.approvalPolicy = options.approvalPolicy ?? "on-request";

    this.proc = spawn(options.bin ?? "codex", ["app-server"], {
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env
    });

    this.setupLogging();

    this.proc.on("error", (error) => {
      this.failAll(error);
      this.logLine("process-error", error.message);
    });

    this.proc.on("exit", (code, signal) => {
      const message = `codex app-server exited (code=${code ?? "?"} signal=${signal ?? "?"})`;
      this.failAll(new Error(message));
      this.logLine("process-exit", message);
      this.emitEvent({
        type: "error",
        sessionId: "unknown",
        turnId: "unknown",
        createdAt: new Date().toISOString(),
        payload: { message, recoverable: true }
      });
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this.handleLine(line));

    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.startHandshake();
  }

  onEvent(handler: TransportEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async createThread(context: WorkspaceContext): Promise<string> {
    await this.ready;

    const result = await this.rpc("thread/start", {
      model: this.model,
      cwd: context.workspaceRoot,
      approvalPolicy: this.approvalPolicy,
      sandbox: this.sandbox
    });

    const threadId = result?.thread?.id as string | undefined;
    if (!threadId) {
      throw new Error("thread/start did not return a thread id");
    }

    const sessionId = context.sessionId ?? threadId;
    this.threadContexts.set(threadId, { sessionId, cwd: context.workspaceRoot });
    this.flushThreadNotification(threadId);
    this.emitThreadStarted(threadId);

    return threadId;
  }

  async sendUserMessage(threadId: string, text: string, attachments?: string[]): Promise<string> {
    await this.ready;

    const context = this.threadContexts.get(threadId);
    const input: Array<{ type: string; text?: string; path?: string }> = [{ type: "text", text }];

    if (attachments && attachments.length > 0) {
      attachments.forEach((path) => {
        input.push({ type: "file", path });
      });
    }

    const result = await this.rpc("turn/start", {
      threadId,
      cwd: context?.cwd,
      input
    });

    const turnId = result?.turn?.id as string | undefined;
    if (!turnId) {
      throw new Error("turn/start did not return a turn id");
    }

    this.turnToThread.set(turnId, threadId);
    return turnId;
  }

  async cancel(targetId: string): Promise<void> {
    await this.ready;
    try {
      await this.rpc("turn/cancel", { turnId: targetId });
    } catch {
      return;
    }
  }

  async respondApproval(
    approvalId: string,
    decision: ApprovalDecision,
    _options?: { rememberRule?: boolean }
  ): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      pending.respond(this.mapDecision(decision));
      this.pendingApprovals.delete(approvalId);
      return;
    }

    const notification = this.pendingNotificationApprovals.get(approvalId);
    if (notification) {
      const payload = {
        approvalId,
        decision: this.mapDecision(decision)
      };
      try {
        await this.rpc("approval/respond", payload);
      } catch {
        return;
      }
    }
  }

  async shutdown(): Promise<void> {
    this.logStream?.end();
    this.proc.kill();
  }

  private startHandshake(): void {
    const id = this.nextId++;
    this.initRequestId = id;
    this.send({
      method: "initialize",
      id,
      params: { clientInfo: { name: "sidekick", title: "Sidekick", version: "0.1.0" } }
    });
  }

  private handleLine(line: string): void {
    this.logRaw("server->client", line);
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.method && typeof msg.id !== "undefined") {
      this.handleServerRequest(msg);
      return;
    }

    if (typeof msg.id !== "undefined") {
      this.handleResponse(msg);
      return;
    }

    if (msg.method) {
      this.handleNotification(msg.method, msg.params ?? {});
    }
  }

  private handleResponse(msg: any): void {
    if (this.initRequestId === msg.id) {
      if (msg.error) {
        const error = new Error(msg.error?.message ?? "initialize failed");
        this.readyReject?.(error);
        return;
      }
      this.send({ method: "initialized", params: {} });
      this.readyResolve?.();
      this.initRequestId = null;
      return;
    }

    const pending = this.pendingRequests.get(msg.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error?.message ?? `RPC error: ${pending.method}`));
      return;
    }

    pending.resolve(msg.result);
  }

  private handleServerRequest(msg: any): void {
    const method = String(msg.method);
    const params = msg.params ?? {};
    const isApproval = method.includes("requestApproval");

    if (isApproval) {
      this.emitApprovalRequest(method, params, msg.id);
      return;
    }

    this.send({
      id: msg.id,
      error: { code: -32000, message: `Unhandled request: ${method}` }
    });
  }

  private handleNotification(method: string, params: any): void {
    const now = new Date().toISOString();

    if (method.startsWith("codex/event/")) {
      this.handleCodexEvent(method, params, now);
      return;
    }

    if (method === "thread/started") {
      const threadId = params?.thread?.id as string | undefined;
      if (!threadId) {
        return;
      }
      if (!this.threadContexts.has(threadId)) {
        this.pendingThreadNotifications.add(threadId);
        return;
      }
      this.emitThreadStarted(threadId);
      return;
    }

    if (method === "turn/started") {
      const threadId = params?.threadId as string | undefined;
      const turnId = params?.turn?.id as string | undefined;
      if (!threadId || !turnId) {
        return;
      }
      this.turnToThread.set(turnId, threadId);
      this.emitEvent({
        type: "turn.started",
        sessionId: this.resolveSessionId(threadId),
        turnId,
        createdAt: now,
        payload: { threadId }
      });
      return;
    }

    if (method === "turn/completed") {
      const threadId = params?.threadId as string | undefined;
      const turn = params?.turn;
      if (!threadId || !turn?.id) {
        return;
      }
      this.emitEvent({
        type: "turn.completed",
        sessionId: this.resolveSessionId(threadId),
        turnId: String(turn.id),
        createdAt: now,
        payload: { threadId, status: turn.status, error: turn.error ?? undefined }
      });
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      const threadId = params?.threadId as string | undefined;
      const turnId = params?.turnId as string | undefined;
      const item = params?.item as Record<string, unknown> | undefined;
      if (!threadId || !turnId || !item) {
        return;
      }

      if (method === "item/completed" && item.type === "agentMessage") {
        const itemId = item.id as string | undefined;
        if (itemId && this.agentMessageBuffers.has(itemId)) {
          this.agentMessageBuffers.delete(itemId);
        }
      }

      this.emitEvent({
        type: method === "item/started" ? "item.started" : "item.completed",
        sessionId: this.resolveSessionId(threadId),
        turnId,
        createdAt: now,
        payload: { threadId, item }
      });
      return;
    }

    if (method === "item/agentMessage/delta") {
      const threadId = params?.threadId as string | undefined;
      const turnId = params?.turnId as string | undefined;
      const itemId = params?.itemId as string | undefined;
      const delta = params?.delta as string | undefined;
      if (!threadId || !turnId || !delta) {
        return;
      }
      if (itemId) {
        const current = this.agentMessageBuffers.get(itemId) ?? "";
        this.agentMessageBuffers.set(itemId, current + delta);
      }
      this.emitEvent({
        type: "item.delta",
        sessionId: this.resolveSessionId(threadId),
        turnId,
        createdAt: now,
        payload: { threadId, itemId, kind: "agentMessage", delta }
      });
      return;
    }

    if (method === "item/commandExecution/outputDelta") {
      const threadId = params?.threadId as string | undefined;
      const turnId = params?.turnId as string | undefined;
      const itemId = params?.itemId as string | undefined;
      const delta = params?.delta as string | undefined;
      if (!threadId || !turnId || !delta) {
        return;
      }
      this.emitEvent({
        type: "item.delta",
        sessionId: this.resolveSessionId(threadId),
        turnId,
        createdAt: now,
        payload: { threadId, itemId, kind: "commandOutput", delta }
      });
      return;
    }

    if (method === "item/reasoning/summaryTextDelta") {
      const threadId = params?.threadId as string | undefined;
      const turnId = params?.turnId as string | undefined;
      const itemId = params?.itemId as string | undefined;
      const delta = params?.delta as string | undefined;
      const summaryIndex = params?.summaryIndex as number | undefined;
      if (!threadId || !turnId || !delta) {
        return;
      }
      this.emitEvent({
        type: "item.delta",
        sessionId: this.resolveSessionId(threadId),
        turnId,
        createdAt: now,
        payload: { threadId, itemId, kind: "reasoningSummary", delta, summaryIndex }
      });
      return;
    }

    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      this.emitApprovalRequest(method, params);
    }
  }

  private emitApprovalRequest(method: string, params: any, requestId?: number): void {
    const threadId = this.resolveThreadId(params);
    const turnId = this.resolveTurnId(params) ?? "unknown";
    const sessionId = this.resolveSessionId(threadId, turnId);
    const approvalId = requestId
      ? String(requestId)
      : this.extractApprovalId(params) ?? `approval_${Date.now()}_${this.nextId++}`;

    const kind = method.includes("commandExecution") ? "command" : "file_write";
    const title = kind === "command" ? "Approve command?" : "Approve file edits?";
    const command = this.extractCommand(params);
    const details: Record<string, unknown> = { method, params };
    if (command) {
      details.command = command;
    }

    const approval: ApprovalRequestWithResponder = {
      id: approvalId,
      sessionId,
      turnId,
      kind,
      title,
      riskLevel: "med",
      details,
      status: "pending",
      createdAt: new Date().toISOString(),
      codexApprovalId: approvalId
    };

    if (requestId) {
      const respond = (decision: "accept" | "decline") => {
        this.send({ id: requestId, result: { decision } });
      };
      approval.respond = respond;
      this.pendingApprovals.set(approvalId, { respond });
    } else {
      this.pendingNotificationApprovals.set(approvalId, { method, params });
    }

    this.emitEvent({
      type: "approval.request",
      sessionId,
      turnId,
      createdAt: approval.createdAt,
      payload: approval
    });
  }

  private rpc(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    this.send({ method, id, params });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, method });
    });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.proc.stdin.writable) {
      throw new Error("codex app-server stdin is not writable");
    }
    this.logLine("client->server", JSON.stringify(message));
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private emitEvent(event: TransportEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitThreadStarted(threadId: string): void {
    if (this.seenThreads.has(threadId)) {
      return;
    }
    this.seenThreads.add(threadId);
    const sessionId = this.resolveSessionId(threadId);
    this.emitEvent({
      type: "thread.started",
      sessionId,
      createdAt: new Date().toISOString(),
      payload: { threadId }
    });
  }

  private flushThreadNotification(threadId: string): void {
    if (this.pendingThreadNotifications.has(threadId)) {
      this.pendingThreadNotifications.delete(threadId);
      this.emitThreadStarted(threadId);
    }
  }

  private resolveThreadId(params: any): string | undefined {
    const value =
      params?.threadId ||
      params?.thread_id ||
      params?.thread?.id ||
      params?.conversationId ||
      params?.item?.threadId ||
      params?.item?.thread_id;
    if (value === undefined || value === null) {
      return undefined;
    }
    return String(value);
  }

  private resolveTurnId(params: any): string | undefined {
    const value =
      params?.turnId ||
      params?.turn_id ||
      params?.turn?.id ||
      params?.item?.turnId ||
      params?.item?.turn_id;
    if (value === undefined || value === null) {
      return undefined;
    }
    return String(value);
  }

  private resolveSessionId(threadId?: string, turnId?: string): string {
    if (threadId && this.threadContexts.has(threadId)) {
      return this.threadContexts.get(threadId)!.sessionId;
    }
    if (turnId && this.turnToThread.has(turnId)) {
      const thread = this.turnToThread.get(turnId);
      if (thread && this.threadContexts.has(thread)) {
        return this.threadContexts.get(thread)!.sessionId;
      }
      return thread ?? turnId;
    }
    return threadId ?? turnId ?? "unknown";
  }

  private extractCommand(params: any): string | undefined {
    const command =
      params?.command ||
      params?.parsedCmd?.cmd ||
      params?.parsed_cmd ||
      params?.item?.command ||
      params?.item?.parsedCmd?.cmd ||
      params?.item?.parsed_cmd;

    if (!command) {
      return undefined;
    }

    if (Array.isArray(command)) {
      return command.join(" ");
    }

    if (typeof command === "string") {
      return command;
    }

    return undefined;
  }

  private extractApprovalId(params: any): string | undefined {
    const id =
      params?.approvalId ||
      params?.approval_id ||
      params?.requestId ||
      params?.request_id ||
      params?.id;

    if (!id) {
      return undefined;
    }

    return String(id);
  }

  private mapDecision(decision: ApprovalDecision): "accept" | "decline" {
    return decision.startsWith("approve") ? "accept" : "decline";
  }

  private handleCodexEvent(method: string, params: any, now: string): void {
    const msg = params?.msg ?? {};
    const threadId = this.resolveThreadId(params) ?? this.resolveThreadId(msg);
    const turnId = this.resolveTurnId(params) ?? this.resolveTurnId(msg) ?? String(params?.id ?? "");
    if (!threadId || !turnId) {
      return;
    }

    if (method === "codex/event/exec_command_begin") {
      const callId = String(msg.call_id ?? msg.callId ?? "");
      const command = this.normalizeCommand(msg.command ?? msg.parsed_cmd ?? msg.parsedCmd);
      this.commandExecutions.set(callId, {
        threadId,
        turnId,
        command,
        cwd: msg.cwd ? String(msg.cwd) : undefined
      });
      this.emitEvent({
        type: "item.started",
        sessionId: this.resolveSessionId(threadId, turnId),
        turnId,
        createdAt: now,
        payload: {
          threadId,
          item: {
            type: "commandExecution",
            id: callId,
            command,
            cwd: msg.cwd ?? undefined,
            status: "inProgress"
          }
        }
      });
      return;
    }

    if (method === "codex/event/exec_command_output_delta") {
      const callId = String(msg.call_id ?? msg.callId ?? "");
      const chunk = typeof msg.chunk === "string" ? msg.chunk : "";
      const delta = this.decodeChunk(chunk);
      const context = this.commandExecutions.get(callId);
      const resolvedThreadId = context?.threadId ?? threadId;
      const resolvedTurnId = context?.turnId ?? turnId;
      if (!delta) {
        return;
      }
      this.emitEvent({
        type: "item.delta",
        sessionId: this.resolveSessionId(resolvedThreadId, resolvedTurnId),
        turnId: resolvedTurnId,
        createdAt: now,
        payload: {
          threadId: resolvedThreadId,
          itemId: callId,
          kind: "commandOutput",
          delta
        }
      });
      return;
    }

    if (method === "codex/event/exec_command_end") {
      const callId = String(msg.call_id ?? msg.callId ?? "");
      const context = this.commandExecutions.get(callId);
      this.commandExecutions.delete(callId);
      const resolvedThreadId = context?.threadId ?? threadId;
      const resolvedTurnId = context?.turnId ?? turnId;
      this.emitEvent({
        type: "item.completed",
        sessionId: this.resolveSessionId(resolvedThreadId, resolvedTurnId),
        turnId: resolvedTurnId,
        createdAt: now,
        payload: {
          threadId: resolvedThreadId,
          item: {
            type: "commandExecution",
            id: callId,
            exitCode: msg.exit_code ?? msg.exitCode ?? undefined,
            durationMs: msg.duration_ms ?? msg.durationMs ?? undefined
          }
        }
      });
      return;
    }

    if (
      method === "codex/event/agent_message_content_delta" ||
      method === "codex/event/agent_message_delta"
    ) {
      const delta = String(msg.delta ?? msg.content ?? msg.text ?? "");
      if (!delta) {
        return;
      }
      this.emitEvent({
        type: "item.delta",
        sessionId: this.resolveSessionId(threadId, turnId),
        turnId,
        createdAt: now,
        payload: {
          threadId,
          kind: "agentMessage",
          delta
        }
      });
    }
  }

  private normalizeCommand(command: unknown): string | undefined {
    if (!command) {
      return undefined;
    }
    if (Array.isArray(command)) {
      return command.map((part) => String(part)).join(" ");
    }
    if (typeof command === "string") {
      return command;
    }
    return undefined;
  }

  private decodeChunk(chunk: string): string {
    if (!chunk) {
      return "";
    }
    const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
    if (chunk.length % 4 === 0 && base64Pattern.test(chunk)) {
      try {
        return Buffer.from(chunk, "base64").toString("utf8");
      } catch {
        return chunk;
      }
    }
    return chunk;
  }

  private setupLogging(): void {
    const logDir =
      process.env.SIDEKICK_LOG_DIR ??
      process.env.CODEX_LOG_DIR ??
      process.env.INIT_CWD ??
      process.cwd();
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `codex_appserver_${timestamp}.log`;
    this.logPath = path.join(logDir, filename);
    this.logStream = fs.createWriteStream(this.logPath, { flags: "a" });
    this.logLine("log-start", `writing to ${this.logPath}`);
    // eslint-disable-next-line no-console
    console.log(`Codex app-server logs: ${this.logPath}`);
  }

  private logLine(prefix: string, value: string): void {
    if (!this.logStream) {
      return;
    }
    this.logStream.write(`[${new Date().toISOString()}] ${prefix} ${value}\n`);
  }

  private logRaw(prefix: string, value: string): void {
    if (!this.logStream) {
      return;
    }
    this.logStream.write(`[${new Date().toISOString()}] ${prefix} ${value}\n`);
  }

  private failAll(error: Error): void {
    this.readyReject?.(error);
    this.pendingRequests.forEach((pending) => pending.reject(error));
    this.pendingRequests.clear();
  }
}

export class TransportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportUnavailableError";
  }
}
