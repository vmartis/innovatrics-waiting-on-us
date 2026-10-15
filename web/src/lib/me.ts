import { useCallback, useEffect, useState } from 'react'

const KEY = 'waiting-on-us:me'

/**
 * Which teammate is using this browser. Remembered locally so you pick your
 * name once; the server only ever accepts a name from its own team list.
 */
export function useMe(): [string | null, (name: string) => void] {
  const [me, setMe] = useState<string | null>(() => localStorage.getItem(KEY))

  // A second tab picking a different name should not leave this one stale.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setMe(event.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const choose = useCallback((name: string) => {
    localStorage.setItem(KEY, name)
    setMe(name)
  }, [])

  return [me, choose]
}
