'use client'

import { useAuthStore } from '@/store/authStore'
import {
  normalizeRole,
  type UserRole,
  canAccessUsers as baseCanAccessUsers,
  canCreate as baseCanCreate,
  canEdit as baseCanEdit,
  canDelete as baseCanDelete,
  canManageUser as baseCanManageUser,
  canAssignOwnerRole as baseCanAssignOwnerRole,
} from '@/lib/permissions'

export function usePermissions() {
  const user = useAuthStore((s) => s.user)
  const role: UserRole = normalizeRole(user?.role)

  return {
    role,
    canAccessUsers: () => baseCanAccessUsers(role),
    canCreate: () => baseCanCreate(role),
    canEdit: () => baseCanEdit(role),
    canDelete: () => baseCanDelete(role),
    canManageUser: (targetRole: UserRole) => baseCanManageUser(role, targetRole),
    canAssignOwnerRole: () => baseCanAssignOwnerRole(role),
  }
}

