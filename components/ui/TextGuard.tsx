import React from 'react'
import { Text } from 'react-native'

type Props = {
  children?: React.ReactNode
}

/**
 * TextGuard: development-only helper that wraps any raw string/number children
 * in <Text> so React Native doesn't throw "Text strings must be rendered within a <Text> component".
 * In production this is a no-op (returns children unchanged).
 */
export function TextGuard({ children }: Props) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return <>{children}</>
  }

  const normalize = (node: React.ReactNode): React.ReactNode => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') {
      return <Text>{String(node)}</Text>
    }
    if (Array.isArray(node)) {
      return node.map((n, i) => <React.Fragment key={i}>{normalize(n)}</React.Fragment>)
    }
    if (React.isValidElement(node)) {
      // Clone element and normalize its children prop
      const props: any = (node.props || {})
      const child = props.children
      if (child === undefined) return node
      return React.cloneElement(node, { ...props, children: normalize(child) })
    }
    // Fallback
    return node
  }

  return <>{normalize(children)}</>
}

export default TextGuard
