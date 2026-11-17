export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42703') return true
  const msg = (error.message ?? '').toLowerCase()
  return (
    (msg.includes('column') &&
      (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find'))) ||
    msg.includes('could not find the') && msg.includes('column')
  )
}

export function isMissingBucketError(error: { message?: string; status?: number } | null | undefined): boolean {
  if (!error) return false
  if (error.status === 404) return true
  const msg = (error.message ?? '').toLowerCase()
  return (
    msg.includes('bucket not found') ||
    msg.includes('not found') && msg.includes('bucket') ||
    (msg.includes('does not exist') && msg.includes('bucket'))
  )
}

export function isMissingRelationError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('does not exist') && (msg.includes('relation') || msg.includes('table'))
}
