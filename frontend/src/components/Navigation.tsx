import { destinations, type Destination } from '../navigation'

interface NavigationProps {
  active: Destination
  onNavigate: (destination: Destination) => void
}

export function Navigation({ active, onNavigate }: NavigationProps) {
  return (
    <nav className="navigation" aria-label="Primary navigation">
      {destinations.map((destination) => (
        <button
          className={
            destination === active
              ? 'navigation__item is-active'
              : 'navigation__item'
          }
          type="button"
          aria-current={destination === active ? 'page' : undefined}
          onClick={() => onNavigate(destination)}
          key={destination}
        >
          <span className="navigation__marker" aria-hidden="true" />
          {destination}
        </button>
      ))}
    </nav>
  )
}
