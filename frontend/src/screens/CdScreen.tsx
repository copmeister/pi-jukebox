import { useState } from 'react'
import { cdArtworkUrl } from '../api/client'
import type { CdRelease, CdRipJob } from '../api/types'
import { ConfirmationPanel } from '../components/ConfirmationPanel'
import { ScreenState } from '../components/ScreenState'
import type { CdState } from '../hooks/useCdStatus'
import { formatTrackDuration } from '../utils/format'

interface CdScreenProps {
  cd: CdState
}

function freeSpace(bytes: number | null): string {
  if (bytes === null) return 'Free space unavailable'
  return `${(bytes / 1_000_000_000).toFixed(1)} GB free`
}

function Candidate({
  release,
  selected,
  disabled,
  onSelect,
}: {
  release: CdRelease
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const details = [release.year, release.country, release.edition]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      className={`cd-release-card${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="cd-release-artwork">
        {release.artwork_available ? (
          <img src={cdArtworkUrl(release.release_id)} alt="" />
        ) : (
          <span aria-hidden="true">CD</span>
        )}
      </span>
      <span className="cd-release-copy">
        <strong>{release.title}</strong>
        <span>{release.artist}</span>
        <small>
          {details || 'Edition details unavailable'} · {release.track_count}{' '}
          tracks
        </small>
      </span>
    </button>
  )
}

function RipProgress({ job }: { job: CdRipJob }) {
  const resolved = job.completed_tracks + job.failed_tracks
  const percentage = Math.round((resolved / job.total_tracks) * 100)
  const current = job.tracks.find((track) =>
    ['reading', 'encoding', 'tagging'].includes(track.state),
  )
  const complete = job.status === 'completed'
  return (
    <section className="cd-rip-progress" aria-label="CD rip progress">
      <header>
        <div>
          <p className="eyebrow">{complete ? 'Rip complete' : job.status}</p>
          <h2>{job.album_title}</h2>
          <p>{job.album_artist}</p>
          {current ? (
            <p>
              Track {current.track_number} of {job.total_tracks}
            </p>
          ) : null}
        </div>
        <strong>{percentage}%</strong>
      </header>
      <div
        className="cd-progress-bar"
        role="progressbar"
        aria-valuenow={resolved}
        aria-valuemin={0}
        aria-valuemax={job.total_tracks}
        aria-label={`${resolved} of ${job.total_tracks} tracks resolved`}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <ol className="cd-track-progress">
        {job.tracks.map((track) => (
          <li className={`is-${track.state}`} key={track.track_number}>
            <span>{track.track_number}</span>
            <strong>{track.title}</strong>
            <small>
              {track.error_message ??
                (complete && track.state === 'ready'
                  ? 'Complete'
                  : track.state.charAt(0).toUpperCase() + track.state.slice(1))}
            </small>
          </li>
        ))}
      </ol>
      <p role={job.error_message ? 'alert' : 'status'}>
        {job.error_message ?? job.message}
      </p>
    </section>
  )
}

export function CdScreen({ cd }: CdScreenProps) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const status = cd.status
  const job = status?.latest_job
  const selected = status?.release_candidates.find(
    (release) => release.release_id === status.selected_release_id,
  )

  if (cd.loading && !status) {
    return (
      <div className="screen">
        <ScreenState
          title="Checking the CD drive"
          message="This will not interrupt music playback."
        />
      </div>
    )
  }
  if (!status) {
    return (
      <div className="screen">
        <ScreenState
          title="CD service unavailable"
          message={cd.error ?? 'Try again shortly.'}
          kind="error"
        />
      </div>
    )
  }

  const terminalJob =
    job &&
    !['queued', 'ripping'].includes(job.status) &&
    status.drive.disc?.disc_id === job.disc_id
  const ripAction = status.rip_action
  const ripButtonLabel =
    ripAction.action === 'resume'
      ? 'Resume Rip'
      : ripAction.action === 'complete'
        ? 'Already in Library'
        : ripAction.action === 'conflict'
          ? 'Rip Conflict'
          : ripAction.action === 'unavailable'
            ? 'Rip Unavailable'
            : 'Rip to Library'
  const canStartRip = ['start', 'resume'].includes(ripAction.action)
  return (
    <div className="screen cd-screen">
      <header className="screen-header cd-header">
        <div>
          <p className="eyebrow">Optical drive</p>
          <h1>CD</h1>
          <p>Securely rip owned audio CDs to the external FLAC library.</p>
        </div>
        <div className="cd-header-actions">
          <span>{freeSpace(status.storage.free_bytes)}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={!status.drive.available || status.active || cd.mutating}
            onClick={() => void cd.eject()}
          >
            Eject CD
          </button>
        </div>
      </header>

      {cd.error ? (
        <p className="cd-feedback is-error" role="alert">
          {cd.error}
        </p>
      ) : null}
      {cd.notice ? (
        <p className="cd-feedback" role="status">
          {cd.notice}
        </p>
      ) : null}

      {job && terminalJob && !status.active ? <RipProgress job={job} /> : null}

      {job && status.active ? (
        <>
          <RipProgress job={job} />
          {confirmCancel ? (
            <ConfirmationPanel
              title="Cancel this CD rip?"
              message="Tracks already marked Ready will be kept. Incomplete temporary files will be removed."
              confirmLabel="Cancel Rip"
              disabled={cd.mutating}
              onCancel={() => setConfirmCancel(false)}
              onConfirm={() => {
                setConfirmCancel(false)
                void cd.cancelRip(job.id)
              }}
            />
          ) : (
            <button
              type="button"
              className="danger-button"
              onClick={() => setConfirmCancel(true)}
            >
              Cancel Rip
            </button>
          )}
        </>
      ) : !status.drive.configured ? (
        <ScreenState
          title="No optical drive configured"
          message="An administrator can configure the USB CD drive without exposing its device path here."
        />
      ) : !status.drive.available ? (
        <ScreenState
          title="Optical drive unavailable"
          message="Check the drive's USB connection and power, then try again."
          kind="error"
        />
      ) : !status.drive.disc_present ? (
        <ScreenState
          title="Insert an audio CD"
          message="The drive is ready. Disc detection happens automatically."
        />
      ) : ['reading', 'searching'].includes(status.metadata_state) ? (
        <ScreenState
          title="Identifying this disc"
          message="Searching MusicBrainz for matching releases and track names."
        />
      ) : (
        <div className="cd-ready-layout">
          <section className="cd-releases" aria-labelledby="release-heading">
            <header>
              <div>
                <p className="eyebrow">Disc identified</p>
                <h2 id="release-heading">
                  {status.release_candidates.length > 1
                    ? 'Choose the correct release'
                    : 'Release details'}
                </h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={cd.mutating}
                onClick={() => void cd.retryMetadata()}
              >
                Retry lookup
              </button>
            </header>
            {status.metadata_message ? (
              <p className="cd-metadata-note">{status.metadata_message}</p>
            ) : null}
            <div className="cd-release-list">
              {status.release_candidates.map((release) => (
                <Candidate
                  release={release}
                  selected={release.release_id === status.selected_release_id}
                  disabled={cd.mutating}
                  onSelect={() => void cd.selectRelease(release.release_id)}
                  key={release.release_id}
                />
              ))}
            </div>
          </section>

          <section className="cd-selected" aria-label="Selected release">
            {selected ? (
              <>
                <header>
                  <div>
                    <h2>{selected.title}</h2>
                    <p>{selected.artist}</p>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      !status.storage.available || !canStartRip || cd.mutating
                    }
                    onClick={() => void cd.startRip(selected.release_id)}
                  >
                    {ripButtonLabel}
                  </button>
                </header>
                {ripAction.action !== 'start' ? (
                  <p
                    className={`cd-rip-assessment${
                      ripAction.action === 'conflict' ? ' is-conflict' : ''
                    }`}
                    role={ripAction.action === 'conflict' ? 'alert' : 'status'}
                  >
                    {ripAction.message}
                  </p>
                ) : null}
                {!status.storage.available ? (
                  <p className="cd-storage-error" role="alert">
                    {status.storage.message}
                  </p>
                ) : null}
                <ol className="cd-track-preview">
                  {selected.tracks.map((track) => (
                    <li key={track.number}>
                      <span>{track.number}</span>
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                      <time>{formatTrackDuration(track.duration_seconds)}</time>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <ScreenState
                title="Select a release"
                message="Tap the edition matching the CD in the drive."
              />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
