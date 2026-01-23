import { nanoid } from "nanoid";
import type { PermissionRule, WorkspaceSettings } from "@sidekick/shared-types";

const rule = (pattern: string, decision: PermissionRule["decision"]): PermissionRule => ({
  id: `rule_${nanoid(6)}`,
  pattern,
  decision
});

export const defaultWorkspaceSettings = (): WorkspaceSettings => ({
  allowNetwork: false,
  allowOutsideRoot: false,
  preferredShell: undefined,
  commandRules: [
    rule("rm -rf", "deny"),
    rule("sudo", "deny"),
    rule("chmod 777", "deny"),
    rule("dd ", "deny"),
    rule("mkfs", "deny"),
    rule("shutdown", "deny"),
    rule("reboot", "deny")
  ],
  pathRules: [
    rule("**/.env", "deny"),
    rule("**/*secret*", "deny"),
    rule("**/id_rsa*", "deny"),
    rule("**/*.pem", "deny"),
    rule("**/keychain*", "deny")
  ],
  toolRules: []
});

export const evaluateRules = (
  rules: PermissionRule[],
  target: string
): { decision: PermissionRule["decision"]; rule?: PermissionRule } => {
  const matched = rules.find((ruleItem) => target.includes(ruleItem.pattern));
  if (!matched) {
    return { decision: "ask" };
  }
  return { decision: matched.decision, rule: matched };
};
