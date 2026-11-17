import { useCallback, useEffect, useState } from 'react'
import {
  AVATAR_BUCKET,
  PROFILE_FIELDS_UNAVAILABLE,
  AVATAR_STORAGE_UNAVAILABLE,
  cropSquareImage,
  withAvatarCacheBust,
  type UserProfile,
} from '../lib/profile'
import { isMissingBucketError, isMissingColumnError, isMissingRelationError } from '../lib/schemaErrors'
import { supabase, syncErrorMessage } from '../lib/supabase'

const PROFILE_COLUMNS = 'id, email, created_at, display_name, bio, avatar_url, updated_at'
const PROFILE_COLUMNS_LEGACY = 'id, email, created_at'

function rowToProfile(row: Record<string, unknown>, fieldsReady: boolean): UserProfile {
  return {
    id: String(row.id),
    email: typeof row.email === 'string' ? row.email : null,
    displayName: fieldsReady && typeof row.display_name === 'string' ? row.display_name : null,
    bio: fieldsReady && typeof row.bio === 'string' ? row.bio : null,
    avatarUrl: fieldsReady && typeof row.avatar_url === 'string' ? row.avatar_url : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: fieldsReady && typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

export function useProfile(userId: string | null, authLoading = false) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [fieldsReady, setFieldsReady] = useState(true)
  const [loading, setLoading] = useState(Boolean(userId) || authLoading)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    if (!supabase) {
      setProfile(null)
      setFieldsReady(false)
      setError('账号服务暂不可用')
      setLoading(false)
      return
    }
    setLoading(true)
    const client = supabase
    try {
      const extended = await client.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle()
      if (extended.error && (isMissingColumnError(extended.error) || isMissingRelationError(extended.error))) {
        const legacy = await client.from('profiles').select(PROFILE_COLUMNS_LEGACY).eq('id', id).maybeSingle()
        if (legacy.error) throw legacy.error
        setFieldsReady(false)
        setError(null)
        setProfile(legacy.data ? rowToProfile(legacy.data as Record<string, unknown>, false) : null)
        setLoading(false)
        return
      }
      if (extended.error) throw extended.error
      setFieldsReady(true)
      setError(null)
      setProfile(extended.data ? rowToProfile(extended.data as Record<string, unknown>, true) : null)
    } catch (err) {
      setProfile(null)
      setError(err instanceof Error ? err.message : syncErrorMessage('加载个人资料'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) {
      setLoading(true)
      return
    }
    if (!userId) {
      setProfile(null)
      setError(null)
      setFieldsReady(true)
      setLoading(false)
      return
    }
    void load(userId)
  }, [userId, authLoading, load])

  const saveProfile = useCallback(
    async (input: { displayName: string | null; bio: string | null }) => {
      if (!userId || !supabase) return { ok: false as const, error: '账号服务暂不可用' }
      if (!fieldsReady) return { ok: false as const, error: PROFILE_FIELDS_UNAVAILABLE }
      const { error: writeErr } = await supabase
        .from('profiles')
        .update({ display_name: input.displayName, bio: input.bio })
        .eq('id', userId)
      if (writeErr) {
        if (isMissingColumnError(writeErr) || isMissingRelationError(writeErr)) {
          setFieldsReady(false)
          return { ok: false as const, error: PROFILE_FIELDS_UNAVAILABLE }
        }
        return { ok: false as const, error: syncErrorMessage('保存个人资料') }
      }
      setProfile((prev) =>
        prev
          ? { ...prev, displayName: input.displayName, bio: input.bio, updatedAt: new Date().toISOString() }
          : prev,
      )
      return { ok: true as const }
    },
    [fieldsReady, userId],
  )

  const uploadAvatar = useCallback(
    async (file: File) => {
      if (!userId || !supabase) return { ok: false as const, error: '账号服务暂不可用' }
      if (!fieldsReady) return { ok: false as const, error: PROFILE_FIELDS_UNAVAILABLE }
      try {
        const cropped = await cropSquareImage(file)
        const path = `${userId}/avatar.${cropped.ext}`
        const { error: uploadErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, cropped.blob, {
          upsert: true,
          contentType: cropped.contentType,
          cacheControl: '3600',
        })
        if (uploadErr) {
          if (isMissingBucketError(uploadErr)) return { ok: false as const, error: AVATAR_STORAGE_UNAVAILABLE }
          return { ok: false as const, error: syncErrorMessage('上传头像') }
        }
        const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
        const avatarUrl = withAvatarCacheBust(data.publicUrl)
        const { error: writeErr } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId)
        if (writeErr) {
          if (isMissingColumnError(writeErr)) {
            setFieldsReady(false)
            return { ok: false as const, error: PROFILE_FIELDS_UNAVAILABLE }
          }
          return { ok: false as const, error: syncErrorMessage('保存头像') }
        }
        setProfile((prev) => (prev ? { ...prev, avatarUrl, updatedAt: new Date().toISOString() } : prev))
        return { ok: true as const }
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : syncErrorMessage('上传头像')
        return { ok: false as const, error: message }
      }
    },
    [fieldsReady, userId],
  )

  const removeAvatar = useCallback(async () => {
    if (!userId || !supabase) return { ok: false as const, error: '账号服务暂不可用' }
    if (!fieldsReady) return { ok: false as const, error: PROFILE_FIELDS_UNAVAILABLE }
    const paths = [`${userId}/avatar.webp`, `${userId}/avatar.jpg`]
    const { error: removeErr } = await supabase.storage.from(AVATAR_BUCKET).remove(paths)
    if (removeErr && !isMissingBucketError(removeErr)) {
      return { ok: false as const, error: syncErrorMessage('移除头像') }
    }
    const { error: writeErr } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
    if (writeErr) {
      if (isMissingColumnError(writeErr)) {
        setFieldsReady(false)
        return { ok: false as const, error: PROFILE_FIELDS_UNAVAILABLE }
      }
      return { ok: false as const, error: syncErrorMessage('移除头像') }
    }
    setProfile((prev) => (prev ? { ...prev, avatarUrl: null, updatedAt: new Date().toISOString() } : prev))
    return { ok: true as const }
  }, [fieldsReady, userId])

  return {
    profile,
    fieldsReady,
    loading,
    error,
    saveProfile,
    uploadAvatar,
    removeAvatar,
    reload: () => (userId ? load(userId) : Promise.resolve()),
  }
}

export type ProfileState = ReturnType<typeof useProfile>
