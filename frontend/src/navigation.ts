export const destinations = [
  'Jukebox',
  'Library',
  'Search',
  'Queue',
  'Now Playing',
] as const

export type Destination = (typeof destinations)[number]
