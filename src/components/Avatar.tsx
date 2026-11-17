import { initialsFrom } from '../lib/profile'

interface Props {
  name?: string | null
  email?: string | null
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Avatar({ name, email, src, size = 'sm', className = '' }: Props) {
  const initials = initialsFrom(name, email)
  const label = name?.trim() || email || '头像'
  return (
    <span className={`avatar avatar--${size} ${className}`.trim()} aria-hidden={false} title={label}>
      {src ? (
        <img src={src} alt="" className="avatar__image" />
      ) : (
        <span className="avatar__initials">{initials}</span>
      )}
    </span>
  )
}
