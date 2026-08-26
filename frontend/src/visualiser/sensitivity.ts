export const VISUALISER_SENSITIVITY_MIN_DB = -6
export const VISUALISER_SENSITIVITY_MAX_DB = 6

export function clampVisualiserSensitivity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.min(
    VISUALISER_SENSITIVITY_MAX_DB,
    Math.max(VISUALISER_SENSITIVITY_MIN_DB, Math.round(numeric)),
  )
}

export function applyVisualiserSensitivity(
  level: number,
  sensitivityDb: number,
): number {
  if (!Number.isFinite(level) || level <= 0) return 0
  const gain = Math.pow(10, clampVisualiserSensitivity(sensitivityDb) / 20)
  return Math.min(1, Math.max(0, level * gain))
}
