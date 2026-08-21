export const VISUALISER_IDS = [
  'spectrum',
  'golden-ratio',
  'particle-galaxy',
  'water',
  'frequency-waves',
] as const

export type VisualiserId = (typeof VISUALISER_IDS)[number]

export const VISUALISER_NAMES: Record<VisualiserId, string> = {
  spectrum: 'Spectrum',
  'golden-ratio': 'Golden Ratio',
  'particle-galaxy': 'Particle Galaxy',
  water: 'Water',
  'frequency-waves': 'Frequency Waves',
}
