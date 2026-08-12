interface PlaceholderScreenProps {
  kicker: string
  title: string
  message: string
}

export function PlaceholderScreen({
  kicker,
  title,
  message,
}: PlaceholderScreenProps) {
  return (
    <div className="screen placeholder-screen">
      <section className="placeholder-panel" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">{kicker}</p>
          <h1 id="page-title">{title}</h1>
          <p>{message}</p>
          <span className="coming-label">Coming in a later milestone</span>
        </div>
        <div className="record-motif" aria-hidden="true">
          <span>♪</span>
        </div>
      </section>
    </div>
  )
}
