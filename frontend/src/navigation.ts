export const destinations = [
  'Jukebox',
  'Library',
  'Search',
  'Queue',
  'Radio',
  'CD',
  'Bluetooth',
  'Now Playing',
  'Settings',
] as const

export type Destination = (typeof destinations)[number]
