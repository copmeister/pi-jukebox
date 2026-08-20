import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CdRipJob, CdStatus } from '../api/types'
import type { CdState } from '../hooks/useCdStatus'
import { CdScreen } from './CdScreen'

const release = {
  release_id: 'release-1',
  title: 'A Very Long Album Title That Still Fits Safely',
  artist: 'Example Artist',
  year: '2024',
  country: 'GB',
  edition: 'Deluxe',
  track_count: 2,
  artwork_available: false,
  disc_number: null,
  disc_total: null,
  tracks: [
    {
      number: 1,
      title: 'Opening Song',
      artist: 'Example Artist',
      duration_seconds: 61,
    },
    { number: 2, title: 'Final Song', artist: 'Guest', duration_seconds: 72 },
  ],
}

const ready: CdStatus = {
  drive: {
    configured: true,
    available: true,
    disc_present: true,
    message: 'Audio CD detected.',
    disc: { disc_id: 'abc', track_count: 2, track_durations: [61, 72] },
  },
  storage: {
    configured: true,
    available: true,
    mounted: true,
    writable: true,
    free_bytes: 50_000_000_000,
    message: 'External storage is ready.',
  },
  metadata_state: 'ready',
  metadata_message: null,
  release_candidates: [release],
  selected_release_id: 'release-1',
  active: false,
  latest_job: null,
  rip_action: {
    action: 'start',
    message: 'This release is ready to rip.',
    source_job_id: null,
  },
}

const cancelledJob: CdRipJob = {
  id: 5,
  status: 'cancelled',
  disc_id: 'abc',
  release_id: 'release-1',
  album_title: release.title,
  album_artist: release.artist,
  total_tracks: 2,
  completed_tracks: 1,
  failed_tracks: 0,
  message: 'Rip cancelled; completed tracks were kept.',
  error_message: null,
  created_at: '2026-08-18T10:00:00Z',
  started_at: '2026-08-18T10:00:01Z',
  finished_at: '2026-08-18T10:01:02Z',
  cancel_requested: true,
  tracks: [
    {
      track_number: 1,
      title: 'Opening Song',
      artist: release.artist,
      duration_seconds: 61,
      state: 'ready',
      final_relative_path: 'Example Artist/Album/01.flac',
      error_message: null,
      updated_at: '2026-08-18T10:01:00Z',
    },
    {
      track_number: 2,
      title: 'Final Song',
      artist: 'Guest',
      duration_seconds: 72,
      state: 'cancelled',
      final_relative_path: null,
      error_message: null,
      updated_at: '2026-08-18T10:01:01Z',
    },
  ],
}

const completedJob: CdRipJob = {
  ...cancelledJob,
  status: 'completed',
  completed_tracks: 2,
  cancel_requested: false,
  message: 'Rip completed successfully.',
  tracks: cancelledJob.tracks.map((track) => ({
    ...track,
    state: 'ready',
    final_relative_path: `Example Artist/Album/${track.track_number}.flac`,
  })),
}

function state(status: CdStatus): CdState {
  return {
    status,
    loading: false,
    mutating: false,
    error: null,
    notice: null,
    refresh: vi.fn(),
    retryMetadata: vi.fn(),
    selectRelease: vi.fn(),
    startRip: vi.fn(),
    cancelRip: vi.fn(),
    eject: vi.fn(),
  }
}

describe('CD touchscreen screen', () => {
  afterEach(cleanup)

  it('shows release details and starts the selected rip without keyboard input', async () => {
    const cd = state(ready)
    const user = userEvent.setup()
    render(<CdScreen cd={cd} />)

    expect(screen.getByText('50.0 GB free')).toBeInTheDocument()
    expect(screen.getByText('Opening Song')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rip to Library' }))
    expect(cd.startRip).toHaveBeenCalledWith('release-1')
    await user.click(screen.getByRole('button', { name: /A Very Long Album/i }))
    expect(cd.selectRelease).toHaveBeenCalledWith('release-1')
  })

  it('shows honest per-track progress and confirms cancellation', async () => {
    const cd = state({
      ...ready,
      active: true,
      latest_job: {
        id: 4,
        status: 'ripping',
        disc_id: 'abc',
        release_id: 'release-1',
        album_title: release.title,
        album_artist: release.artist,
        total_tracks: 2,
        completed_tracks: 1,
        failed_tracks: 0,
        message: 'Reading track 2.',
        error_message: null,
        created_at: '2026-08-18T10:00:00Z',
        started_at: '2026-08-18T10:00:01Z',
        finished_at: null,
        cancel_requested: false,
        tracks: [
          {
            track_number: 1,
            title: 'Opening Song',
            artist: release.artist,
            duration_seconds: 61,
            state: 'ready',
            final_relative_path: 'Example/Album/01.flac',
            error_message: null,
            updated_at: '2026-08-18T10:01:00Z',
          },
          {
            track_number: 2,
            title: 'Final Song',
            artist: 'Guest',
            duration_seconds: 72,
            state: 'reading',
            final_relative_path: null,
            error_message: null,
            updated_at: '2026-08-18T10:01:01Z',
          },
        ],
      },
    })
    const user = userEvent.setup()
    render(<CdScreen cd={cd} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '1',
    )
    expect(screen.getByText('Reading')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel Rip' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Rip' }))
    expect(cd.cancelRip).toHaveBeenCalledWith(4)
  })

  it('offers Resume Rip after cancellation and preserves the progress view', async () => {
    const cd = state({
      ...ready,
      latest_job: cancelledJob,
      rip_action: {
        action: 'resume',
        message:
          'Resume will keep 1 verified track and rip only the remainder.',
        source_job_id: cancelledJob.id,
      },
    })
    const user = userEvent.setup()
    render(<CdScreen cd={cd} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '1',
    )
    expect(screen.getByText(/keep 1 verified track/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume Rip' }))
    expect(cd.startRip).toHaveBeenCalledWith('release-1')
  })

  it('labels a successful inserted-disc job as complete', () => {
    render(
      <CdScreen
        cd={state({
          ...ready,
          latest_job: completedJob,
          rip_action: {
            action: 'complete',
            message: 'This release is already complete in the library.',
            source_job_id: completedJob.id,
          },
        })}
      />,
    )

    expect(screen.getByText('Rip complete')).toBeInTheDocument()
    expect(screen.getAllByText('Complete')).toHaveLength(2)
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
  })

  it('clears completed release and track state after physical eject', () => {
    render(
      <CdScreen
        cd={state({
          ...ready,
          drive: { ...ready.drive, disc_present: false, disc: null },
          release_candidates: [],
          selected_release_id: null,
          latest_job: completedJob,
          rip_action: {
            action: 'unavailable',
            message: 'Insert an audio CD first.',
            source_job_id: null,
          },
        })}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Insert an audio CD' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Rip complete')).not.toBeInTheDocument()
    expect(screen.queryByText(release.title)).not.toBeInTheDocument()
  })

  it('shows a safe conflict and never offers an enabled rip action', () => {
    render(
      <CdScreen
        cd={state({
          ...ready,
          latest_job: cancelledJob,
          rip_action: {
            action: 'conflict',
            message:
              'Existing track 1 could not be verified. Nothing will be overwritten.',
            source_job_id: cancelledJob.id,
          },
        })}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      /nothing will be overwritten/i,
    )
    expect(screen.getByRole('button', { name: 'Rip Conflict' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Resume Rip' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    [
      'No optical drive configured',
      {
        ...ready,
        drive: { ...ready.drive, configured: false, available: false },
      },
    ],
    [
      'Insert an audio CD',
      { ...ready, drive: { ...ready.drive, disc_present: false, disc: null } },
    ],
    [
      'Identifying this disc',
      { ...ready, metadata_state: 'searching' as const },
    ],
  ])('renders the %s state', (heading, status) => {
    render(<CdScreen cd={state(status)} />)
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('disables ripping when external storage is unsafe', () => {
    render(
      <CdScreen
        cd={state({
          ...ready,
          storage: {
            ...ready.storage,
            available: false,
            mounted: false,
            message: 'The external drive is not mounted. Ripping is disabled.',
          },
        })}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Rip to Library' }),
    ).toBeDisabled()
    expect(
      screen.getByText(/external drive is not mounted/i),
    ).toBeInTheDocument()
  })
})
