interface ConfirmationPanelProps {
  title: string
  message: string
  confirmLabel: string
  disabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationPanel({
  title,
  message,
  confirmLabel,
  disabled = false,
  onConfirm,
  onCancel,
}: ConfirmationPanelProps) {
  return (
    <section
      className="confirmation-panel"
      role="alertdialog"
      aria-labelledby="confirm-title"
    >
      <div>
        <strong id="confirm-title">{title}</strong>
        <p>{message}</p>
      </div>
      <div className="confirmation-panel__actions">
        <button type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={onConfirm}
          disabled={disabled}
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  )
}
