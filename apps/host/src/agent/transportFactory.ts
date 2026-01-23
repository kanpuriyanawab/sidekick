import { MockTransport } from "./mockTransport";
import { CodexAppServerTransport, type CodexTransport, type SandboxMode } from "@sidekick/transport-codex-appserver";

export const createTransport = (): CodexTransport => {
  const useMock = process.env.USE_MOCK_TRANSPORT === "1" || process.env.SIDEKICK_TRANSPORT === "mock";
  if (useMock) {
    return new MockTransport();
  }

  const sandbox = normalizeSandbox(process.env.CODEX_SANDBOX);
  return new CodexAppServerTransport({
    bin: process.env.CODEX_BIN ?? "codex",
    model: process.env.CODEX_MODEL ?? "gpt-5.2-codex",
    sandbox,
    approvalPolicy: process.env.CODEX_APPROVAL_POLICY ?? "on-request"
  });
};

const normalizeSandbox = (value?: string): SandboxMode => {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  return "workspace-write";
};
