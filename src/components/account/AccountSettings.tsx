import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ProfileState } from '../../hooks/useProfile'
import { BIO_MAX, DISPLAY_NAME_MAX, PROFILE_FIELDS_UNAVAILABLE } from '../../lib/profile'
import { authErrorMessage, supabase } from '../../lib/supabase'
import { Avatar } from '../Avatar'

interface Props {
  user: User
  profileState: ProfileState
}

export function AccountSettings({ user, profileState }: Props) {
  const { profile, fieldsReady, loading, error, saveProfile, uploadAvatar, removeAvatar } = profileState
  const email = profile?.email || user.email || ''
  const fileRef = useRef<HTMLInputElement>(null)

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  const [profileErr, setProfileErr] = useState<string | null>(null)

  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null)
  const [avatarErr, setAvatarErr] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)
  const [passwordErr, setPasswordErr] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '')
    setBio(profile?.bio ?? '')
  }, [profile?.displayName, profile?.bio])

  const profileBlocked = !fieldsReady || (!loading && !profile)

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault()
    const name = displayName.trim()
    const nextBio = bio.trim()
    if (name && (name.length < 1 || name.length > DISPLAY_NAME_MAX)) {
      setProfileErr(`显示名称需为 1–${DISPLAY_NAME_MAX} 个字符`)
      setProfileMsg(null)
      return
    }
    if (nextBio.length > BIO_MAX) {
      setProfileErr(`简介不能超过 ${BIO_MAX} 个字`)
      setProfileMsg(null)
      return
    }
    setProfileBusy(true)
    setProfileErr(null)
    setProfileMsg(null)
    const result = await saveProfile({ displayName: name || null, bio: nextBio || null })
    setProfileBusy(false)
    if (!result.ok) setProfileErr(result.error)
    else setProfileMsg('资料已保存')
  }

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return
    setAvatarBusy(true)
    setAvatarErr(null)
    setAvatarMsg(null)
    const result = await uploadAvatar(file)
    setAvatarBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (!result.ok) setAvatarErr(result.error)
    else setAvatarMsg('头像已更新')
  }

  const onRemoveAvatar = async () => {
    setAvatarBusy(true)
    setAvatarErr(null)
    setAvatarMsg(null)
    const result = await removeAvatar()
    setAvatarBusy(false)
    if (!result.ok) setAvatarErr(result.error)
    else setAvatarMsg('头像已移除')
  }

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordErr(null)
    setPasswordMsg(null)
    if (!email) {
      setPasswordErr('无法验证当前账号')
      return
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordErr('请填写当前密码和新密码')
      return
    }
    if (newPassword.length < 6) {
      setPasswordErr('新密码至少需要 6 个字符')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordErr('两次输入的新密码不一致')
      return
    }
    if (newPassword === currentPassword) {
      setPasswordErr('新密码不能与当前密码相同')
      return
    }
    if (!supabase) {
      setPasswordErr('账号服务暂不可用')
      return
    }
    setPasswordBusy(true)
    try {
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (verifyErr) {
        setPasswordErr(authErrorMessage(verifyErr))
        return
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
      if (updateErr) {
        setPasswordErr(authErrorMessage(updateErr))
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMsg('密码已更新')
    } catch {
      setPasswordErr('操作失败，请稍后重试')
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <div className="account-settings">
      <section className="account-card">
        <h2>个人资料</h2>
        {loading && <p className="account-muted">正在加载资料…</p>}
        {!loading && profileBlocked && (
          <p className="auth-msg auth-msg--error">{error || PROFILE_FIELDS_UNAVAILABLE}</p>
        )}
        {!loading && !profileBlocked && (
          <form className="account-form" onSubmit={(e) => void onSaveProfile(e)}>
            <div className="account-avatar-row">
              <Avatar name={displayName || profile?.displayName} email={email} src={profile?.avatarUrl} size="lg" />
              <div className="account-avatar-actions">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="account-file"
                  aria-label="上传头像"
                  onChange={(e) => void onPickAvatar(e.target.files?.[0])}
                  disabled={avatarBusy}
                />
                <div className="account-avatar-buttons">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={avatarBusy}
                    onClick={() => fileRef.current?.click()}
                  >
                    {profile?.avatarUrl ? '更换头像' : '上传头像'}
                  </button>
                  {profile?.avatarUrl && (
                    <button type="button" className="btn btn-ghost" disabled={avatarBusy} onClick={() => void onRemoveAvatar()}>
                      移除头像
                    </button>
                  )}
                </div>
                <p className="account-hint">将自动裁成正方形。支持 JPG、PNG、WebP、GIF，最大 10 MB。</p>
                {avatarErr && <p className="auth-msg auth-msg--error">{avatarErr}</p>}
                {avatarMsg && <p className="auth-msg">{avatarMsg}</p>}
              </div>
            </div>
            <label>
              显示名称
              <input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value)
                  setProfileMsg(null)
                  setProfileErr(null)
                }}
                maxLength={DISPLAY_NAME_MAX}
                placeholder="1–20 个字符"
              />
              <span className="account-count">
                {displayName.trim().length}/{DISPLAY_NAME_MAX}
              </span>
            </label>
            <label>
              简介
              <textarea
                value={bio}
                onChange={(e) => {
                  setBio(e.target.value)
                  setProfileMsg(null)
                  setProfileErr(null)
                }}
                maxLength={BIO_MAX}
                rows={4}
                placeholder="可选，最多 200 字"
              />
              <span className="account-count">
                {bio.length}/{BIO_MAX}
              </span>
            </label>
            <label>
              邮箱
              <input value={email} readOnly disabled />
            </label>
            {profileErr && <p className="auth-msg auth-msg--error">{profileErr}</p>}
            {profileMsg && <p className="auth-msg">{profileMsg}</p>}
            <div className="account-form__actions">
              <button type="submit" className="btn btn-primary" disabled={profileBusy}>
                {profileBusy ? '保存中…' : '保存资料'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="account-card">
        <h2>修改密码</h2>
        <form className="account-form" onSubmit={(e) => void onChangePassword(e)}>
          <label>
            当前密码
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value)
                setPasswordErr(null)
                setPasswordMsg(null)
              }}
              required
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value)
                setPasswordErr(null)
                setPasswordMsg(null)
              }}
              minLength={6}
              required
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                setPasswordErr(null)
                setPasswordMsg(null)
              }}
              minLength={6}
              required
            />
          </label>
          {passwordErr && <p className="auth-msg auth-msg--error">{passwordErr}</p>}
          {passwordMsg && <p className="auth-msg">{passwordMsg}</p>}
          <div className="account-form__actions">
            <button type="submit" className="btn btn-primary" disabled={passwordBusy}>
              {passwordBusy ? '更新中…' : '更新密码'}
            </button>
          </div>
        </form>
      </section>

      <section className="account-card">
        <h2>绑定账号</h2>
        <p className="account-muted">第三方登录暂未开放</p>
      </section>
    </div>
  )
}
