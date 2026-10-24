import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// In-app replacement for window.confirm, which the Tauri webview doesn't support
// (it silently returns false there).
export function ConfirmDialog({ message, confirmLabel = "Apagar", onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  // Portaled: the sidebar is transformed on mobile, which would trap fixed overlays.
  return createPortal(
    <div className="mic-test-overlay" onClick={onCancel}>
      <div className="mic-test-modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button className="confirm-danger" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
