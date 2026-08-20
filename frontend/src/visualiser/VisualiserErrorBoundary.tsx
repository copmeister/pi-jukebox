import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onFailure: () => void
}

interface State {
  failed: boolean
}

export class VisualiserErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onFailure()
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          className="spectrum-canvas"
          role="img"
          aria-label="Visualiser unavailable"
        />
      )
    }
    return this.props.children
  }
}
