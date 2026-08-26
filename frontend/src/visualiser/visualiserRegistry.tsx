/* eslint-disable react-refresh/only-export-components -- this module is the visualiser registry */
import type { ComponentType } from 'react'
import type { SpectrumFrame } from '../api/types'
import { ConcentricSquaresCanvas } from './ConcentricSquaresCanvas'
import type { ConcentricSquareColour } from './concentricSquares'
import { GoldenRatioCanvas } from './GoldenRatioCanvas'
import { SpectrumCanvas } from './SpectrumCanvas'
import type { SpectrumColourScheme } from './spectrum'
import { VISUALISER_NAMES, type VisualiserId } from './visualiserTypes'

export interface VisualiserRendererProps {
  frame: SpectrumFrame | null
  colourScheme: SpectrumColourScheme
  solidColour: ConcentricSquareColour
  sensitivityDb: number
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
  sensitivityDb,
}: VisualiserRendererProps) {
  return (
    <SpectrumCanvas
      frame={frame}
      riseRate={riseRate}
      fallRate={fallRate}
      colourScheme={colourScheme}
      sensitivityDb={sensitivityDb}
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
    id: 'concentric-squares',
    name: VISUALISER_NAMES['concentric-squares'],
    logicalBandCount: 9,
    Renderer: ConcentricSquaresCanvas,
  },
]

export function visualiserDefinition(id: VisualiserId): VisualiserDefinition {
  return (
    VISUALISER_REGISTRY.find((definition) => definition.id === id) ??
    VISUALISER_REGISTRY[0]
  )
}
