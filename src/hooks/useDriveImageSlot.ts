import { useEffect, useState } from 'react'
import {
  DRIVE_IMAGE_SESSION_ENDED,
  acquireDriveImage,
  isDriveImageSessionEndedError,
  peekDriveImage,
  peekDriveImageSession,
  releaseDriveImage,
  subscribeDriveImageSession,
  type DriveImagePriority,
  type DriveImageRecord,
  type DriveImageSessionState,
} from '../lib/driveImageCache'

export interface DriveImageSlot {
  url: string | null
  blob: Blob | null
  error: string | null
  loading: boolean
}

const EMPTY_SLOT: DriveImageSlot = { url: null, blob: null, error: null, loading: false }

const SIGNED_OUT_SLOT: DriveImageSlot = {
  url: null,
  blob: null,
  error: DRIVE_IMAGE_SESSION_ENDED,
  loading: false,
}

function userFacingError(error: unknown): string {
  if (isDriveImageSessionEndedError(error)) return error.message
  if (error instanceof Error && error.message.trim()) {
    if (error.message.includes('相册图片缓存已清空')) return '无法载入图片，请稍后重试'
    return error.message
  }
  return '无法载入图片'
}

function isSignedOut(token: string | null, session: DriveImageSessionState): boolean {
  return !token || session.status === 'ended'
}

function useDriveImageSession(): DriveImageSessionState {
  const [session, setSession] = useState<DriveImageSessionState>(() => peekDriveImageSession())
  useEffect(() => subscribeDriveImageSession(setSession), [])
  return session
}

export function useDriveImageSlot(input: {
  token: string | null
  fileId: string | null
  priority?: DriveImagePriority
}): DriveImageSlot {
  const token = input.token
  const fileId = input.fileId
  const priority = input.priority ?? 'high'
  const session = useDriveImageSession()
  const signedOut = isSignedOut(token, session)
  const [slot, setSlot] = useState<DriveImageSlot>(() => (signedOut ? SIGNED_OUT_SLOT : EMPTY_SLOT))

  useEffect(() => {
    if (signedOut || !token) {
      setSlot(SIGNED_OUT_SLOT)
      return
    }
    if (!fileId) {
      setSlot(EMPTY_SLOT)
      return
    }
    let cancelled = false
    let record: DriveImageRecord | null = null
    const cached = peekDriveImage(fileId)
    if (cached) {
      setSlot({ url: cached.url, blob: cached.blob, error: null, loading: false })
    } else {
      setSlot({ url: null, blob: null, error: null, loading: true })
    }

    const load = (attempt: number) => {
      void acquireDriveImage(token, fileId, priority)
        .then((next) => {
          if (cancelled) {
            releaseDriveImage(next)
            return
          }
          record = next
          setSlot({ url: next.url, blob: next.blob, error: null, loading: false })
        })
        .catch((error) => {
          if (cancelled) return
          if (isDriveImageSessionEndedError(error)) {
            setSlot(SIGNED_OUT_SLOT)
            return
          }
          if (attempt < 1) {
            load(attempt + 1)
            return
          }
          setSlot({ url: null, blob: null, error: userFacingError(error), loading: false })
        })
    }
    load(0)

    return () => {
      cancelled = true
      if (record) releaseDriveImage(record)
    }
  }, [token, fileId, priority, signedOut])

  return slot
}
