import type { ApprovalDecision, ApprovalRequest } from "@sidekick/shared-types";

interface ApprovalModalProps {
  approval: ApprovalRequest;
  onDecision: (decision: ApprovalDecision) => void;
}

export const ApprovalModal = ({ approval, onDecision }: ApprovalModalProps) => {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>{approval.title}</h2>
          <span className={`risk-chip ${approval.riskLevel}`}>{approval.riskLevel} risk</span>
        </div>

        <div className="modal-body">
          <p className="muted">{approval.kind.toUpperCase()} request</p>
          <pre>{JSON.stringify(approval.details, null, 2)}</pre>
        </div>

        <div className="modal-actions">
          <button className="primary-button" onClick={() => onDecision("approve_once")}>
            Approve once
          </button>
          <button className="ghost-button" onClick={() => onDecision("approve_always")}>
            Always allow
          </button>
          <button className="ghost-button danger" onClick={() => onDecision("deny_once")}>
            Deny once
          </button>
          <button className="ghost-button danger" onClick={() => onDecision("deny_always")}>
            Always deny
          </button>
        </div>
      </div>
    </div>
  );
};
