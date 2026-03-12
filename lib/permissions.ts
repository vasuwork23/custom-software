export type UserRole = 'owner' | 'admin' | 'manager' | 'viewer'

export interface AppUser {
  id: string
  fullName: string
  email: string
  role: string
}

export function normalizeRole(role: string | null | undefined): UserRole {
  if (role === 'owner' || role === 'admin' || role === 'manager' || role === 'viewer') {
    return role
  }
  return 'viewer'
}

// -------- Frontend-style permissions (generic helpers) --------

export function canAccessUsers(role: UserRole): boolean {
  return role === 'owner' || role === 'admin'
}

export function canCreate(role: UserRole): boolean {
  return role !== 'viewer'
}

export function canEdit(role: UserRole): boolean {
  return role !== 'viewer'
}

export function canDelete(role: UserRole): boolean {
  // Managers cannot delete financial records; at UI level we treat all deletes as disallowed
  return role === 'owner' || role === 'admin'
}

// For user management actions that depend on target role
export function canManageUser(activeRole: UserRole, targetRole: UserRole): boolean {
  if (activeRole === 'owner') return true
  if (activeRole === 'admin') {
    // Admin cannot manage owner users
    return targetRole !== 'owner'
  }
  return false
}

export function canAssignOwnerRole(activeRole: UserRole): boolean {
  return activeRole === 'owner'
}

// -------- Backend helpers (for route handlers) --------

export function ensureNotViewer(user: { role: string } | null): { ok: boolean; message?: string } {
  if (!user) return { ok: false, message: 'Unauthorized' }
  const role = normalizeRole(user.role)
  if (role === 'viewer') {
    return { ok: false, message: 'View-only role cannot perform this action' }
  }
  return { ok: true }
}

export function ensureCanDelete(user: { role: string } | null): { ok: boolean; message?: string } {
  if (!user) return { ok: false, message: 'Unauthorized' }
  const role = normalizeRole(user.role)
  if (role === 'viewer' || role === 'manager') {
    return { ok: false, message: 'You do not have permission to delete this record' }
  }
  return { ok: true }
}

export function ensureOwnerOrAdmin(user: { role: string } | null): { ok: boolean; message?: string } {
  if (!user) return { ok: false, message: 'Unauthorized' }
  const role = normalizeRole(user.role)
  if (role === 'owner' || role === 'admin') return { ok: true }
  return { ok: false, message: 'Only Owner or Admin can perform this action' }
}

export function ensureOwner(user: { role: string } | null): { ok: boolean; message?: string } {
  if (!user) return { ok: false, message: 'Unauthorized' }
  const role = normalizeRole(user.role)
  if (role === 'owner') return { ok: true }
  return { ok: false, message: 'Only Owner can perform this action' }
}

