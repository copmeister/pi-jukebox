export interface RadioStation {
  id: string
  name: string
  streamUrl: string
  artwork?: string
  mark: string
  accent: string
}

// Keep the curated catalogue and every external media URL in this one file.
// These HTTPS MP3 endpoints returned HTTP 200 audio/mpeg data on 2026-08-20.
export const RADIO_STATIONS: readonly RadioStation[] = [
  {
    id: 'classic-fm',
    name: 'Classic FM',
    streamUrl: 'https://media-ice.musicradio.com/ClassicFMMP3',
    artwork: '/radio/classic-fm.svg',
    mark: 'CFM',
    accent: '#9f8cff',
  },
  {
    id: 'classic-fm-movies',
    name: 'Classic FM Movies',
    streamUrl: 'https://media-ice.musicradio.com/ClassicFMMoviesMP3',
    mark: 'MOV',
    accent: '#d59b52',
  },
  {
    id: 'smooth-radio',
    name: 'Smooth Radio',
    streamUrl: 'https://media-ice.musicradio.com/SmoothUKMP3',
    mark: 'SM',
    accent: '#ee7088',
  },
  {
    id: 'heart',
    name: 'Heart',
    streamUrl: 'https://media-ice.musicradio.com/HeartUKMP3',
    mark: 'H',
    accent: '#ff496c',
  },
  {
    id: 'capital',
    name: 'Capital',
    streamUrl: 'https://media-ice.musicradio.com/CapitalUKMP3',
    artwork: '/radio/capital.png',
    mark: 'C',
    accent: '#25a9e8',
  },
  {
    id: 'lbc',
    name: 'LBC',
    streamUrl: 'https://media-ice.musicradio.com/LBCUKMP3',
    mark: 'LBC',
    accent: '#f2523c',
  },
]

export function radioStationById(id: string): RadioStation | undefined {
  return RADIO_STATIONS.find((station) => station.id === id)
}
