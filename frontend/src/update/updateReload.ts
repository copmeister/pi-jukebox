import type { UpdateStatus } from '../api/types'

export const UPDATE_RELOAD_STORAGE_KEY = 'pi-jukebox:update-reload:v1'

export function updateOutcomeNeedsReload(
  status: UpdateStatus,
  requestedVersion: string | null,
): boolean {
  return Boolean(
    requestedVersion &&
    status.requested_version === requestedVersion &&
    (status.outcome === 'succeeded' || status.outcome === 'rolled_back'),
  )
}

export function rememberRequestedUpdate(version: string | null) {
  if (!version) return
  try {
    window.sessionStorage.setItem(UPDATE_RELOAD_STORAGE_KEY, version)
  } catch {
    // A browser that blocks session storage still receives the update safely.
  }
}
