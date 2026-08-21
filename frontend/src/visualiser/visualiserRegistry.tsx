/* eslint-disable react-refresh/only-export-components -- this module is the visualiser registry */
import type { ComponentType } from 'react'
import type { SpectrumFrame } from '../api/types'
import { FrequencyWavesCanvas } from './FrequencyWavesCanvas'
import { GoldenRatioCanvas } from './GoldenRatioCanvas'
import { ParticleGalaxyCanvas } from './ParticleGalaxyCanvas'
import { SpectrumCanvas } from './SpectrumCanvas'
import type { SpectrumColourScheme } from './spectrum'
import { VISUALISER_NAMES, type VisualiserId } from './visualiserTypes'
import { WaterCanvas } from './WaterCanvas'

export interface VisualiserRendererProps {
  frame: SpectrumFrame | null
  colourScheme: SpectrumColourScheme
  riseRate?: number
  fallRate?: number
  onFailure?: () => void
}

export interface VisualiserDefinition {
  id: VisualiserId
  name: string
  logicalBandCount: number
  Renderer: ComponentType<VisualiserRendererProps>
}

function SpectrumRenderer({
  frame,
  colourScheme,
  riseRate,
  fallRate,
}: VisualiserRendererProps) {
  return (
    <SpectrumCanvas
      frame={frame}
      riseRate={riseRate}
      fallRate={fallRate}
      colourScheme={colourScheme}
    />
  )
}

export const VISUALISER_REGISTRY: readonly VisualiserDefinition[] = [
  {
    id: 'spectrum',
    name: VISUALISER_NAMES.spectrum,
    logicalBandCount: 24,
    Renderer: SpectrumRenderer,
  },
  {
    id: 'golden-ratio',
    name: VISUALISER_NAMES['golden-ratio'],
    logicalBandCount: 6,
    Renderer: GoldenRatioCanvas,
  },
  {
    id: 'particle-galaxy',
    name: VISUALISER_NAMES['particle-galaxy'],
    logicalBandCount: 6,
    Renderer: ParticleGalaxyCanvas,
  },
  {
    id: 'water',
    name: VISUALISER_NAMES.water,
    logicalBandCount: 6,
    Renderer: WaterCanvas,
  },
  {
    id: 'frequency-waves',
    name: VISUALISER_NAMES['frequency-waves'],
    logicalBandCount: 6,
    Renderer: FrequencyWavesCanvas,
  },
]

export function visualiserDefinition(id: VisualiserId): VisualiserDefinition {
  return (
    VISUALISER_REGISTRY.find((definition) => definition.id === id) ??
    VISUALISER_REGISTRY[0]
  )
}
