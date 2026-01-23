// test_appserver.mjs
// Strict handshake + verbose logging for Codex App Server.
//
// Run:
//   node test_appserver.mjs
//
// Optional env:
//   CODEX_BIN=codex
//   CODEX_MODEL=gpt-5.2-codex
//   CODEX_CWD=/path/to/workspace

import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const MODEL = process.env.CODEX_MODEL || "gpt-5.2-codex";
const CWD = process.env.CODEX_CWD || process.cwd();

// Safety: auto-approve only these if an approval request appears
const SAFE_CMD_PREFIXES = [
    "ls",
    "pwd",
    "whoami",
    "cat ",
    "head ",
    "tail ",
    "rg ",
    "find ",
    "git status",
    "git diff",
];

function extractInnerCommand(commandStr) {
    if (!commandStr || typeof commandStr !== "string") return "";
    const m = commandStr.match(/-lc\s+(.+)$/);
    if (m?.[1]) return m[1].trim();
    const m2 = commandStr.match(/-c\s+(.+)$/);
    if (m2?.[1]) return m2[1].trim();
    return commandStr.trim();
}

function isSafeCommand(cmd) {
    const c = cmd.trim();
    return SAFE_CMD_PREFIXES.some((p) => c === p || c.startsWith(p));
}

const proc = spawn(CODEX_BIN, ["app-server"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
});

proc.on("exit", (code, signal) => {
    console.log(`\n[app-server exited] code=${code} signal=${signal}`);
});

proc.on("error", (err) => {
    console.error("[spawn error]", err);
    process.exit(1);
});

const rl = readline.createInterface({ input: proc.stdout });

function send(msg) {
    // show what we send (debug)
    console.log("client->server:", msg);
    proc.stdin.write(JSON.stringify(msg) + "\n");
}

let nextId = 1;
function rpc(method, params) {
    const id = nextId++;
    send({ method, id, params });
    return id;
}

let threadId = null;
let turnId = null;
let initDone = false;
let startedThread = false;
let startedTurn = false;

function shutdown(exitCode = 0) {
    try {
        proc.kill();
    } catch { }
    process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));

// ---- Main message handler ----
rl.on("line", (line) => {
    let msg;
    try {
        msg = JSON.parse(line);
    } catch {
        console.log("[server non-json]", line);
        return;
    }

    console.log("server->client:", msg);

    // A) Server-initiated request (method + id): approvals or other callbacks
    if (msg.method && typeof msg.id !== "undefined") {
        const method = msg.method;

        const isApproval =
            method.includes("requestApproval") ||
            method === "item/commandExecution/requestApproval" ||
            method === "item/fileChange/requestApproval";

        if (isApproval) {
            const p = msg.params || {};
            const cmdStr =
                p.command ||
                p.parsedCmd?.cmd ||
                p.parsed_cmd ||
                p.item?.command ||
                p.item?.parsedCmd?.cmd ||
                "";

            const cmd = Array.isArray(cmdStr) ? cmdStr.join(" ") : String(cmdStr);
            const inner = extractInnerCommand(cmd);
            const safe = isSafeCommand(inner);

            console.log(
                `\n[approval requested]\n  method=${method}\n  cmd=${cmd}\n  inner=${inner}\n  decision=${safe ? "ACCEPT" : "DECLINE"}\n`
            );

            // respond to server request
            send({
                id: msg.id,
                result: { decision: safe ? "accept" : "decline" },
            });
            return;
        }

        // Unknown server request: respond with error so it won't hang
        send({ id: msg.id, error: { code: -32000, message: `Unhandled request: ${method}` } });
        return;
    }

    // B) Standard response (id present, with result/error)
    if (typeof msg.id !== "undefined") {
        // initialize response
        if (msg.result?.userAgent && !initDone) {
            initDone = true;

            // now send initialized (strict ordering)
            send({ method: "initialized", params: {} });

            // now start thread
            if (!startedThread) {
                startedThread = true;
                rpc("thread/start", {
                    model: MODEL,
                    cwd: CWD,
                    approvalPolicy: "on-request",
                    sandbox: "workspace-write",
                });
            }
            return;
        }

        // thread/start response
        if (msg.result?.thread?.id && !threadId) {
            threadId = msg.result.thread.id;

            // start a turn
            if (!startedTurn) {
                startedTurn = true;
                rpc("turn/start", {
                    threadId,
                    cwd: CWD,
                    input: [
                        {
                            type: "text",
                            text:
                                "Say hello, then list the files in the current directory. " +
                                "Then print the absolute working directory path.",
                        },
                    ],
                });
            }
            return;
        }

        // turn/start response
        if (msg.result?.turn?.id && !turnId) {
            turnId = msg.result.turn.id;
            return;
        }

        // error responses
        if (msg.error) {
            console.error("[server error response]", msg.error);
        }

        return;
    }

    // C) Notifications (method without id)
    if (msg.method === "turn/completed") {
        console.log("\n[turn completed]", msg.params?.turn?.status, msg.params?.turn?.error || "");
        shutdown(0);
        return;
    }

    // Print agent message deltas (if present)
    if (msg.method === "item/agentMessage/delta") {
        process.stdout.write(msg.params?.delta ?? "");
        return;
    }

    // Print command output deltas (if present)
    if (msg.method === "item/commandExecution/outputDelta") {
        process.stdout.write(msg.params?.delta ?? "");
        return;
    }
});

// ---- Start handshake ----
// IMPORTANT: only send initialize here.
// We'll send initialized + thread/start only after we get initialize response.
rpc("initialize", {
    clientInfo: { name: "sidekick", title: "Sidekick", version: "0.1.0" },
});

// Fail fast if we don't progress
setTimeout(() => {
    if (!threadId) {
        console.error(
            "\n[timeout] Never got thread id. Likely handshake/order mismatch or server rejected thread/start.\n" +
            "Scroll up for any server error responses.\n"
        );
        shutdown(1);
    }
}, 15000);
