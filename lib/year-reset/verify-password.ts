import bcrypt from 'bcryptjs'
import User from '@/models/User'

/**
 * Confirm the caller's own login password, server-side, on every reset call.
 *
 * A password checked in the browser is decoration — the endpoint is still one
 * curl away. This is compared against the stored bcrypt hash for the signed-in
 * user, so it has to be re-entered for preview and for execute alike.
 */
export async function verifyOwnPassword(
  userId: string,
  password: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, message: 'Your password is required to continue' }
  }
  const user = await User.findById(userId).select('+password role').lean()
  if (!user) return { ok: false, message: 'User not found' }
  if (user.role !== 'owner') return { ok: false, message: 'Only Owner can perform this action' }

  const match = await bcrypt.compare(password, user.password)
  if (!match) return { ok: false, message: 'That password is not correct' }
  return { ok: true }
}
