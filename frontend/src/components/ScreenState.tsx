interface ScreenStateProps {
  title: string
  message: string
  kind?: 'loading' | 'empty' | 'error'
  actionLabel?: string
  onAction?: () => void
}

export function ScreenState({
  title,
  message,
  kind = 'empty',
  actionLabel,
  onAction,
}: ScreenStateProps) {
  return (
    <section
      className={`screen-state screen-state--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="screen-state__mark" aria-hidden="true">
        {kind === 'loading' ? '•••' : kind === 'error' ? '!' : '♪'}
      </div>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      {actionLabel && onAction ? (
        <button className="secondary-button" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  )
}
