'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Landmark,
  Package,
  Ship,
  Building2,
  FileText,
  Wallet,
  Banknote,
  BarChart3,
  Receipt,
  Flag,
  Users,
  ShieldAlert,
  Truck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { Separator } from '@/components/ui/separator'
import { authHeaders } from '@/lib/api-client'

type NavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  roles?: readonly ['owner', 'admin']
}

const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/china-bank', label: 'China Bank', icon: Landmark },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/containers', label: 'Containers', icon: Ship },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/sale-bills', label: 'Sale Bills', icon: FileText },
  { href: '/carrying', label: 'Carrying', icon: Truck },
  { href: '/received-voucher', label: 'Receive Voucher', icon: Wallet },
  { href: '/banks', label: 'Our Banks', icon: Banknote },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/sophia', label: 'Sophia', icon: Flag },
  { href: '/liabilities', label: 'Liabilities', icon: ShieldAlert },
  { href: '/users', label: 'Users', icon: Users, roles: ['owner', 'admin'] },
]

type DotState = 'idle' | 'running' | 'success' | 'error'

function NavContent() {
  const pathname = usePathname()
  const user = useAuthStore((s) => s.user)

  return (
    <nav className="flex flex-col gap-1 px-2 py-4">
      {navItems.map((item) => {
        if (item.roles && user && !item.roles.includes(user.role as 'owner' | 'admin')) {
          return null
        }
        const isActive =
          item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  const user = useAuthStore((s) => s.user)
  const [dotState, setDotState] = useState<DotState>('idle')

  const handleDotClick = async () => {
    if (dotState === 'running') return
    if (user?.role !== 'owner') return

    setDotState('running')

    try {
      const res = await fetch('/api/admin/cloud-backup', {
        method: 'POST',
        headers: {
          ...authHeaders(),
        },
      })
      const data = await res.json()

      if (data?.success) {
        setDotState('success')
        setTimeout(() => setDotState('idle'), 5000)
      } else {
        setDotState('error')
        setTimeout(() => setDotState('idle'), 5000)
      }
    } catch {
      setDotState('error')
      setTimeout(() => setDotState('idle'), 5000)
    }
  }

  return (
    <aside className="relative hidden h-full w-64 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Package className="h-6 w-6" />
          <span className="text-foreground">Import Export</span>
        </Link>
      </div>
      <Separator />
      <NavContent />
      {user?.role === 'owner' && (
        <div
          onClick={handleDotClick}
          className={cn(
            'w-2 h-2 rounded-full cursor-pointer absolute bottom-4 left-4',
            'transition-colors duration-500',
            {
              'bg-gray-300': dotState === 'idle',
              'bg-blue-400 animate-pulse': dotState === 'running',
              'bg-green-400': dotState === 'success',
              'bg-red-400': dotState === 'error',
            }
          )}
        />
      )}
    </aside>
  )
}

export function SidebarSheetContent() {
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Package className="h-6 w-6" />
        <span className="font-semibold">Import Export</span>
      </div>
      <Separator />
      <NavContent />
    </>
  )
}

