export const destinations = [
  'Jukebox',
  'Library',
  'Search',
  'Queue',
  'CD',
  'Bluetooth',
  'Now Playing',
  'Settings',
] as const

export type Destination = (typeof destinations)[number]
