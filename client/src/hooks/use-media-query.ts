import * as React from 'react'

const getMatches = (query: string): boolean => {
  if (typeof window !== 'undefined') {
    return window.matchMedia(query).matches
  }
  return false
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(getMatches(query))

  React.useEffect(() => {
    const matchMedia = window.matchMedia(query)

    const handleChange = () => {
      setMatches(getMatches(query))
    }

    matchMedia.addEventListener('change', handleChange)

    return () => {
      matchMedia.removeEventListener('change', handleChange)
    }
  }, [query])

  return matches
}
