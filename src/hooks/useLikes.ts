import { useCallback, useEffect, useMemo, useState } from 'react'
import { LIKES_KEY, loadLikes, saveLikes } from '../lib/localStore'
import { supabase, syncErrorMessage } from '../lib/supabase'
import { mergeLocalIntoAccount } from '../lib/accountSync'

export { LIKES_KEY }

export function useLikes(userId: string | null = null, authLoading = false) {
  const [ids, setIds] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : loadLikes(),
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!userId || !supabase) {
      setIds(loadLikes())
      return
    }

    let cancelled = false
    const client = supabase
    ;(async () => {
      try {
        await mergeLocalIntoAccount(userId)
        if (cancelled) return
        const { data, error: loadError } = await client.from('likes').select('item_id').eq('user_id', userId)
        if (loadError) throw loadError
        if (!cancelled) {
          setError(null)
          setIds((data ?? []).map((row) => row.item_id as string))
        }
      } catch {
        if (!cancelled) setError(syncErrorMessage('同步喜欢'))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [userId, authLoading])

  const idSet = useMemo(() => new Set(ids), [ids])

  const isLiked = useCallback((id: string) => idSet.has(id), [idSet])

  const toggle = useCallback(
    (itemId: string) => {
      let snapshot: string[] = []
      let removing = false
      setIds((prev) => {
        snapshot = prev
        removing = prev.includes(itemId)
        const next = removing ? prev.filter((id) => id !== itemId) : [...prev, itemId]
        if (!userId || !supabase) saveLikes(next)
        return next
      })
      setError(null)
      if (!userId || !supabase) return
      const client = supabase
      void (async () => {
        const result = removing
          ? await client.from('likes').delete().eq('user_id', userId).eq('item_id', itemId)
          : await client.from('likes').insert({ user_id: userId, item_id: itemId })
        if (result.error) {
          setIds(snapshot)
          setError(syncErrorMessage(removing ? '取消喜欢' : '喜欢'))
        }
      })()
    },
    [userId],
  )

  return { ids, idSet, isLiked, toggle, count: ids.length, error }
}
