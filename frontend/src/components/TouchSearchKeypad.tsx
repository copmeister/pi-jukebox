const LETTER_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
]
const NUMBER_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

interface TouchSearchKeypadProps {
  value: string
  onChange: (value: string) => void
  onHide: () => void
}

export function TouchSearchKeypad({
  value,
  onChange,
  onHide,
}: TouchSearchKeypadProps) {
  const append = (character: string) => onChange(`${value}${character}`)

  return (
    <section className="touch-keypad" aria-label="Touch search keypad">
      <div className="touch-keypad__row touch-keypad__numbers">
        {NUMBER_ROW.map((number) => (
          <button
            key={number}
            type="button"
            onClick={() => append(number)}
            aria-label={`Enter ${number}`}
          >
            {number}
          </button>
        ))}
      </div>
      {LETTER_ROWS.map((row) => (
        <div className="touch-keypad__row" key={row.join('')}>
          {row.map((letter) => (
            <button
              key={letter}
              type="button"
              onClick={() => append(letter.toLowerCase())}
              aria-label={`Enter ${letter}`}
            >
              {letter}
            </button>
          ))}
        </div>
      ))}
      <div className="touch-keypad__row touch-keypad__actions">
        <button
          type="button"
          onClick={() => append(' ')}
          aria-label="Enter space"
        >
          Space
        </button>
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          disabled={!value}
          aria-label="Backspace"
        >
          Backspace
        </button>
        <button
          type="button"
          onClick={() => onChange('')}
          disabled={!value}
          aria-label="Clear search"
        >
          Clear
        </button>
        <button type="button" onClick={onHide} aria-label="Hide keypad">
          Hide
        </button>
      </div>
    </section>
  )
}
