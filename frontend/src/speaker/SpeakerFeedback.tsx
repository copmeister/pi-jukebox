import {
  formatSpeakerStatus,
  type SpeakerState,
  type SpeakerEndpoint,
} from './speakerState'

export function SpeakerFeedback({
  state,
  syncedEndpoint,
}: {
  state: SpeakerState
  syncedEndpoint: SpeakerEndpoint | null
}) {
  return (
    <div
      className="speaker-feedback"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <strong>{formatSpeakerStatus(state)}</strong>
      {syncedEndpoint ? <small>VOLUME SYNCED · MIN</small> : null}
    </div>
  )
}
