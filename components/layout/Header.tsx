'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  Menu,
  LogOut,
  Moon,
  Sun,
  KeyRound,
  CloudUpload,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthStore } from '@/store/authStore'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { SidebarSheetContent } from '@/components/layout/Sidebar'
import { ChangePasswordDialog } from '@/components/layout/ChangePasswordDialog'
import { authHeaders } from '@/lib/api-client'

const pathTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/china-bank': 'China Bank',
  '/products': 'Products',
  '/companies': 'Companies',
  '/sale-bills': 'Sale Bills',
  '/received-voucher': 'Receive Voucher',
  '/banks': 'Our Banks',
  '/reports': 'Reports',
  '/expenses': 'Expenses',
  '/sophia': 'Sophia',
  '/users': 'Users',
}

function getPageTitle(pathname: string): string {
  if (pathTitles[pathname]) return pathTitles[pathname]
  for (const [path, title] of Object.entries(pathTitles)) {
    if (path !== '/' && pathname.startsWith(path)) return title
  }
  return 'Dashboard'
}

function roleBadgeVariant(
  role: string
): 'default' | 'secondary' | 'outline' | 'success' {
  switch (role) {
    case 'owner':
      return 'default'
    case 'admin':
      return 'secondary'
    case 'manager':
      return 'outline'
    default:
      return 'outline'
  }
}

function getInitials(fullName: string, email: string): string {
  if (fullName?.trim()) {
    const parts = fullName.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2)
    return fullName.slice(0, 2).toUpperCase()
  }
  if (email?.trim()) return email.slice(0, 2).toUpperCase()
  return '?'
}

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { user, clearAuth } = useAuthStore()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [atlasConfigured, setAtlasConfigured] = useState(false)
  const [backupState, setBackupState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')

  const title = getPageTitle(pathname ?? '/')
  const displayName = user?.fullName?.trim() || user?.email || 'User'
  const role = user?.role ? String(user.role).toLowerCase() : ''
  const initials = getInitials(user?.fullName ?? '', user?.email ?? '')

  useEffect(() => {
    async function checkStatus() {
      if (user?.role !== 'owner') {
        setAtlasConfigured(false)
        return
      }
      try {
        const res = await fetch('/api/admin/backup-status', {
          headers: {
            ...authHeaders(),
          },
        })
        const data = await res.json()
        if (data?.success) {
          setAtlasConfigured(Boolean(data.atlasConfigured))
        }
      } catch {
        // ignore — button will stay hidden
      }
    }

    checkStatus()
  }, [user?.role])

  const handleBackup = async () => {
    if (backupState === 'running') return
    setBackupState('running')

    try {
      const res = await fetch('/api/admin/normal-backup', {
        method: 'POST',
        headers: {
          ...authHeaders(),
        },
      })
      const data = await res.json()

      if (data?.success) {
        setBackupState('success')
        setTimeout(async () => {
          setBackupState('idle')
          try {
            const statusRes = await fetch('/api/admin/backup-status', {
              headers: {
                ...authHeaders(),
              },
            })
            const statusData = await statusRes.json()
            if (statusData?.success) {
              setAtlasConfigured(Boolean(statusData.atlasConfigured))
            }
          } catch {
            // ignore
          }
        }, 3000)
      } else {
        setBackupState('error')
        setTimeout(() => setBackupState('idle'), 4000)
      }
    } catch {
      setBackupState('error')
      setTimeout(() => setBackupState('idle'), 4000)
    }
  }

  function handleLogout() {
    clearAuth()
    router.replace('/login')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
      {/* Mobile menu */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SidebarSheetContent />
        </SheetContent>
      </Sheet>

      <h1 className="text-lg font-semibold truncate flex-1">{title}</h1>

      <div className="flex items-center gap-2">
        {user?.role === 'owner' && atlasConfigured && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBackup}
            disabled={backupState === 'running'}
            title={
              backupState === 'idle'
                ? 'Backup to Cloud'
                : backupState === 'running'
                  ? 'Backing up...'
                  : backupState === 'success'
                    ? 'Backup Complete!'
                    : 'Backup Failed — Click to retry'
            }
            aria-label="Backup to cloud"
          >
            {backupState === 'idle' && (
              <CloudUpload className="h-5 w-5 text-gray-500" />
            )}
            {backupState === 'running' && (
              <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
            )}
            {backupState === 'success' && (
              <CheckCircle className="h-5 w-5 text-green-500" />
            )}
            {backupState === 'error' && (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 h-9 px-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                aria-hidden
              >
                {initials}
              </span>
              <div className="hidden flex-col items-start text-left sm:flex">
                <span className="truncate text-sm font-medium max-w-[120px]">{displayName}</span>
                {role && (
                  <Badge variant={roleBadgeVariant(user?.role ?? '')} className="capitalize text-[10px] px-1.5 py-0">
                    {role}
                  </Badge>
                )}
              </div>
              {role && (
                <Badge variant={roleBadgeVariant(user?.role ?? '')} className="capitalize sm:hidden">
                  {role}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{user?.fullName || user?.email || 'User'}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {user?.email}
                </span>
                {user?.role && (
                  <Badge variant={roleBadgeVariant(user.role)} className="capitalize w-fit mt-1">
                    {user.role}
                  </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              Reset Password
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
      </div>
    </header>
  )
}
