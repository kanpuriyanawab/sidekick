import http from "http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import type { ApprovalDecisionInput } from "@sidekick/shared-types";
import { SqliteStore, type Store } from "./db/store";
import { MemoryStore } from "./db/memoryStore";
import { AgentManager } from "./agent/manager";
import { createTransport } from "./agent/transportFactory";

export interface HostServerOptions {
  port: number;
  dbPath: string;
}

export const startServer = ({ port, dbPath }: HostServerOptions) => {
  const app = express();
  const server = http.createServer(app);
  const wsServer = new WebSocketServer({ server, path: "/events" });

  let store: Store;
  try {
    store = new SqliteStore(dbPath);
  } catch (error) {
    const message = (error as Error).message ?? "";
    // eslint-disable-next-line no-console
    console.warn(`SQLite unavailable, falling back to in-memory store: ${message}`);
    store = new MemoryStore();
  }
  const transport = createTransport();
  const agentManager = new AgentManager(store, transport);

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: process.env.SIDEKICK_TRANSPORT ?? "mock" });
  });

  app.get("/workspaces", (_req, res) => {
    res.json(store.listWorkspaces());
  });

  app.post("/workspaces", (req, res) => {
    const workspace = store.createWorkspace(req.body);
    res.json(workspace);
  });

  app.post("/sessions", (req, res) => {
    const session = store.createSession(req.body);
    res.json(session);
  });

  app.get("/sessions", (req, res) => {
    const workspaceId = req.query.workspaceId as string | undefined;
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required" });
      return;
    }
    res.json(store.listSessions(workspaceId));
  });

  app.get("/timeline", (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    res.json(store.listTimelineItems(sessionId));
  });

  app.post("/agent/send", async (req, res) => {
    try {
      const { sessionId, message } = req.body as { sessionId: string; message: string };
      const turnId = await agentManager.sendMessage(sessionId, message);
      res.json({ turnId });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/agent/approval", async (req, res) => {
    try {
      const input = req.body as ApprovalDecisionInput;
      await agentManager.respondApproval(input);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  wsServer.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "hello", payload: { status: "connected" } }));
  });

  agentManager.onEvent((event) => {
    const message = JSON.stringify({ type: "event", payload: event });
    wsServer.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Sidekick host listening on :${port}`);
  });

  return { app, server, wsServer };
};
