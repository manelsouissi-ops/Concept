"use client";

import { useEffect, useState } from "react";

export function FciConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  acknowledgeLabel,
  requireAcknowledgement = false,
  commentLabel,
  commentPlaceholder,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  acknowledgeLabel?: string;
  requireAcknowledgement?: boolean;
  commentLabel?: string;
  commentPlaceholder?: string;
  onCancel: () => void;
  onConfirm: (input: { acknowledged: boolean; comment: string | null }) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) {
      setAcknowledged(false);
      setComment("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fci-dialog-backdrop" role="presentation">
      <div className="fci-dialog" role="dialog" aria-modal="true" aria-labelledby="fci-dialog-title">
        <div className="fci-dialog-header">
          <h3 id="fci-dialog-title">{title}</h3>
          <p>{description}</p>
        </div>
        {commentLabel ? (
          <label className="fci-dialog-field">
            <span>{commentLabel}</span>
            <textarea
              className="input textarea"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={commentPlaceholder}
              rows={3}
            />
          </label>
        ) : null}
        {requireAcknowledgement ? (
          <label className="fci-dialog-checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              {acknowledgeLabel ??
                "Je confirme avoir pris connaissance de l'etat stale de la source."}
            </span>
          </label>
        ) : null}
        <div className="fci-dialog-actions">
          <button type="button" className="button button-ghost" onClick={onCancel}>
            Annuler
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => onConfirm({ acknowledged, comment: comment.trim() || null })}
            disabled={requireAcknowledgement && !acknowledged}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
