'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client'
import { usePermissions } from '@/hooks/use-permissions'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Users } from 'lucide-react'

type Role = 'owner' | 'admin' | 'manager' | 'viewer'
type Status = 'active' | 'inactive'

interface UserRow {
  id: string
  fullName: string
  email: string
  role: Role
  status: Status
  failedLoginAttempts: number
  isBlocked: boolean
}

const userFormSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
  role: z.enum(['owner', 'admin', 'manager', 'viewer']),
  status: z.enum(['active', 'inactive']),
})

type UserFormValues = z.infer<typeof userFormSchema>

const resetSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Confirm password is required'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type ResetFormValues = z.infer<typeof resetSchema>

export default function UsersPage() {
  const {
    role: currentRole,
    canAccessUsers,
    canCreate,
    canEdit,
    canDelete,
    canManageUser,
    canAssignOwnerRole,
  } = usePermissions()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetSaving, setResetSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [resetUser, setResetUser] = useState<UserRow | null>(null)
  const [recalcLoading, setRecalcLoading] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
  })

  const {
    register: registerReset,
    handleSubmit: handleSubmitReset,
    reset: resetResetForm,
    formState: { errors: resetErrors },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
  })

  const isEdit = !!editingUser
  const roleValue = watch('role') as Role | undefined

  useEffect(() => {
    if (!canAccessUsers()) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const res = await apiGet<{ users: UserRow[] }>('/api/users')
      if (!cancelled) {
        if (!res.success) {
          toast.error(res.message)
        } else {
          setUsers(res.data.users)
        }
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole])

  async function handleRecalculateBalances() {
    setRecalcLoading(true)
    try {
      const calls = [
        apiPost<{ fixed: boolean }>('/api/fix/sophia-balances', {}),
        apiPost<{ fixed: boolean }>('/api/fix/bank-balances', {}),
        apiPost<{ fixed: boolean }>('/api/fix/china-bank-balances', {}),
        apiPost('/api/fix/fix-buying-entry-reversal-transaction-dates', {}),
      ]
      const results = await Promise.all(calls)
      const ok = results.every((r) => r.success)
      if (ok) {
        toast.success('All balances recalculated successfully')
      } else {
        const firstError = results.find((r) => !r.success)
        toast.error(firstError?.message ?? 'Failed to recalculate some balances')
      }
    } catch {
      toast.error('Error while recalculating balances')
    } finally {
      setRecalcLoading(false)
    }
  }

  function openAddDialog() {
    setEditingUser(null)
    reset({
      fullName: '',
      email: '',
      password: '',
      role: 'viewer',
      status: 'active',
    })
    setDialogOpen(true)
  }

  function openEditDialog(user: UserRow) {
    setEditingUser(user)
    reset({
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
    })
    setDialogOpen(true)
  }

  function openResetDialog(user: UserRow) {
    setResetUser(user)
    resetResetForm({
      newPassword: '',
      confirmPassword: '',
    })
    setResetDialogOpen(true)
  }

  async function handleSave(values: UserFormValues) {
    if (!canCreate() && !isEdit) {
      toast.error('You do not have permission to create users')
      return
    }
    if (!canEdit() && isEdit) {
      toast.error('You do not have permission to edit users')
      return
    }
    if (values.role === 'owner' && !canAssignOwnerRole()) {
      toast.error('Only Owner can assign Owner role')
      return
    }

    setSaving(true)
    try {
      if (isEdit && editingUser) {
        const payload: Partial<UserFormValues> = {
          fullName: values.fullName,
          email: values.email,
          role: values.role,
          status: values.status,
        }
        const res = await apiPut<UserRow>(`/api/users/${editingUser.id}`, payload)
        if (!res.success) {
          toast.error(res.message)
        } else {
          setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? { ...u, ...res.data } : u)))
          toast.success('User updated')
          setDialogOpen(false)
        }
      } else {
        if (!values.password) {
          toast.error('Password is required for new user')
          return
        }
        const res = await apiPost<UserRow>('/api/users', values)
        if (!res.success) {
          toast.error(res.message)
        } else {
          setUsers((prev) => [...prev, res.data])
          toast.success('User created')
          setDialogOpen(false)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(user: UserRow) {
    if (!canDelete()) {
      toast.error('You do not have permission to delete users')
      return
    }
    if (user.role === 'owner') {
      toast.error('Cannot delete Owner account')
      return
    }
    const res = await apiDelete<{ id: string }>(`/api/users/${user.id}`)
    if (!res.success) {
      toast.error(res.message)
    } else {
      setUsers((prev) => prev.filter((u) => u.id !== user.id))
      toast.success('User deleted')
    }
  }

  async function handleResetPassword(values: ResetFormValues) {
    if (!resetUser) return
    setResetSaving(true)
    try {
      const res = await apiPost<{ id: string }>(`/api/users/${resetUser.id}/reset-password`, {
        newPassword: values.newPassword,
      })
      if (!res.success) {
        toast.error(res.message)
      } else {
        toast.success('Password reset successfully')
        setResetDialogOpen(false)
      }
    } finally {
      setResetSaving(false)
    }
  }

  async function handleUnblock(user: UserRow) {
    const res = await apiPost<{ id: string }>(`/api/users/${user.id}/unblock`, {})
    if (!res.success) {
      toast.error(res.message)
    } else {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, isBlocked: false, failedLoginAttempts: 0 } : u
        )
      )
      toast.success('User unblocked')
    }
  }

  const roleBadgeClass = (role: Role) => {
    switch (role) {
      case 'owner':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200'
      case 'admin':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
      case 'manager':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
      case 'viewer':
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-200'
    }
  }

  if (!canAccessUsers()) {
    return (
      <div className="space-y-6">
        <PageHeader title="Users" description="You do not have access to this page." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage users and roles (Owner/Admin only)."
        action={
          <div className="flex gap-2">
            {currentRole === 'owner' && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRecalculateBalances}
                disabled={recalcLoading}
              >
                {recalcLoading ? 'Recalculating…' : 'Recalculate All Balances'}
              </Button>
            )}
            {canCreate() && (
              <Button size="sm" onClick={openAddDialog}>
                Add User
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <TableSkeleton rows={6} columns={7} />
          ) : users.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No users yet"
              description="Users are created by Owner or Admin. Add a user to give access to the system."
            >
              {canCreate() && (
                <Button size="sm" onClick={openAddDialog}>
                  Add User
                </Button>
              )}
            </EmptyState>
          ) : (
            <div className="w-full overflow-hidden rounded-md border">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left font-medium">Full Name</th>
                    <th className="p-3 text-left font-medium">Email</th>
                    <th className="p-3 text-left font-medium">Role</th>
                    <th className="p-3 text-left font-medium">Status</th>
                    <th className="p-3 text-right font-medium">Failed Attempts</th>
                    <th className="p-3 text-left font-medium">Blocked</th>
                    <th className="p-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const canManageThisUser = canManageUser(user.role)
                    return (
                      <tr key={user.id} className="border-b">
                        <td className="p-3">{user.fullName}</td>
                        <td className="p-3">{user.email}</td>
                        <td className="p-3">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                              roleBadgeClass(user.role)
                            )}
                          >
                            {user.role.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant={user.status === 'active' ? 'default' : 'destructive'}
                            className={user.status === 'active' ? 'bg-emerald-600 text-white' : ''}
                          >
                            {user.status === 'active' ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {user.failedLoginAttempts ?? 0}
                        </td>
                        <td className="p-3">
                          {user.isBlocked ? (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-200">
                              Blocked
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                              OK
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-2">
                            {canEdit() && canManageThisUser && (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => openEditDialog(user)}
                              >
                                Edit
                              </Button>
                            )}
                            {/* Reset password — Owner only (current user must be owner), hide for others */}
                            {currentRole === 'owner' && user.role !== 'owner' && (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => openResetDialog(user)}
                              >
                                Reset Password
                              </Button>
                            )}
                            {/* Unblock — Owner only, show if blocked */}
                            {currentRole === 'owner' && user.isBlocked && (
                              <ConfirmDialog
                                trigger={
                                  <Button variant="outline" size="xs">
                                    Unblock
                                  </Button>
                                }
                                title="Unblock user"
                                description={`Are you sure you want to unblock ${user.fullName}?`}
                                confirmLabel="Unblock"
                                variant="default"
                                onConfirm={() => handleUnblock(user)}
                              />
                            )}
                            {/* Delete — hidden for owner user */}
                            {user.role !== 'owner' && canDelete() && canManageThisUser && (
                              <ConfirmDialog
                                trigger={
                                  <Button variant="destructive" size="xs">
                                    Delete
                                  </Button>
                                }
                                title="Delete user"
                                description={`Are you sure you want to delete ${user.fullName}?`}
                                confirmLabel="Delete"
                                onConfirm={() => handleDelete(user)}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit User' : 'Add User'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Update user information. Password is not shown here.'
                : 'Create a new user. Password is required.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmit(handleSave)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" {...register('fullName')} />
              {errors.fullName && (
                <p className="text-xs text-destructive">{errors.fullName.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
            {!isEdit && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...register('password')} />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>
            )}
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Password is not editable here. Use &quot;Reset Password&quot; to set a new password.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                {...register('role')}
              >
                <option value="owner" disabled={!canAssignOwnerRole()}>
                  Owner
                </option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="viewer">Viewer</option>
              </select>
              {errors.role && (
                <p className="text-xs text-destructive">{errors.role.message}</p>
              )}
              {roleValue === 'owner' && !canAssignOwnerRole() && (
                <p className="text-xs text-destructive">
                  Only Owner can assign the Owner role.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                {...register('status')}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {errors.status && (
                <p className="text-xs text-destructive">{errors.status.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetUser?.fullName}. Make sure to share it securely.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmitReset(handleResetPassword)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input id="newPassword" type="password" {...registerReset('newPassword')} />
              {resetErrors.newPassword && (
                <p className="text-xs text-destructive">{resetErrors.newPassword.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                {...registerReset('confirmPassword')}
              />
              {resetErrors.confirmPassword && (
                <p className="text-xs text-destructive">
                  {resetErrors.confirmPassword.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={resetSaving}>
                {resetSaving ? 'Saving…' : 'Reset password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

