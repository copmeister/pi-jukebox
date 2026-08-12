export const destinations = [
  'Home',
  'Library',
  'Search',
  'Queue',
  'Now Playing',
] as const

export type Destination = (typeof destinations)[number]
