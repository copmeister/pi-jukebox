export const VISUALISER_IDS = [
  'spectrum',
  'golden-ratio',
  'particle-galaxy',
  'water',
] as const

export type VisualiserId = (typeof VISUALISER_IDS)[number]

export const VISUALISER_NAMES: Record<VisualiserId, string> = {
  spectrum: 'Spectrum',
  'golden-ratio': 'Golden Ratio',
  'particle-galaxy': 'Particle Galaxy',
  water: 'Water',
}
