import React from 'react'
import { Button } from './ui/button'
import { useI18n } from '@dlient-open/i18n'

export interface PluginErrorBoundaryProps {
  pluginName: string
  children: React.ReactNode
  fallback?: (error: Error, reset: () => void) => React.ReactNode
}

interface PluginErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

type InnerProps = PluginErrorBoundaryProps & {
  t: (key: string, ...args: unknown[]) => React.ReactNode
}

class PluginErrorBoundaryInner extends React.Component<InnerProps, PluginErrorBoundaryState> {
  constructor(props: InnerProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[PluginErrorBoundary] ${this.props.pluginName} crashed:`, error, errorInfo)
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!, this.reset)
      }
      return (
        <div
          className="dui-error-box"
          style={{
            padding: 16,
            borderRadius: 'calc(var(--radius) - 2px)',
            border: '1px solid color-mix(in oklab, var(--destructive) 30%, transparent)',
            background: 'color-mix(in oklab, var(--destructive) 8%, transparent)',
          }}
        >
          <h3 style={{ color: 'var(--destructive)', fontWeight: 600, margin: '0 0 8px' }}>
            {this.props.t('ui.errorBoundaryTitle', this.props.pluginName)}
          </h3>
          <p style={{ color: 'var(--destructive)', fontSize: 12, margin: '0 0 12px' }}>{this.state.error?.message}</p>
          <Button variant="destructive" size="sm" onClick={this.reset}>
            {this.props.t('ui.errorBoundaryRetry')}
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

// class 组件无法直接用 hook，用函数组件包一层注入 t
export function PluginErrorBoundary(props: PluginErrorBoundaryProps) {
  const { t } = useI18n()
  return <PluginErrorBoundaryInner {...props} t={t} />
}
