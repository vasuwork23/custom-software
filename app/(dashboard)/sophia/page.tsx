'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Trash2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AmountDisplay } from '@/components/ui/AmountDisplay'
import { ChinaPersonDialog } from '@/components/jack/ChinaPersonDialog'
import { PayInOutDialog } from '@/components/jack/PayInOutDialog'
import { SophiaPayOutDialog } from '@/components/jack/SophiaPayOutDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiGet, apiDelete } from '@/lib/api-client'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'

interface PersonRow {
  _id: string
  name: string
  isDefault: boolean
  currentBalance: number
  payInCount: number
  payOutCount: number
  paymentsMadeCount: number
}

export default function SophiaPage() {
  const [persons, setPersons] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [personDialogOpen, setPersonDialogOpen] = useState(false)
  const [editingPerson, setEditingPerson] = useState<{ _id: string; name: string } | null>(null)
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [payDialogPerson, setPayDialogPerson] = useState<{ id: string; name: string } | null>(null)
  const [payDialogMode, setPayDialogMode] = useState<'pay_in' | 'pay_out'>('pay_in')

  const fetchPersons = useCallback(async () => {
    setLoading(true)
    const result = await apiGet<{ persons: PersonRow[] }>('/api/sophia')
    setLoading(false)
    if (result.success) setPersons(result.data.persons)
    else toast.error(result.message)
  }, [])

  useEffect(() => {
    fetchPersons()
  }, [fetchPersons])

  function openAddPerson() {
    setEditingPerson(null)
    setPersonDialogOpen(true)
  }

  function openEditPerson(p: PersonRow) {
    setEditingPerson({ _id: p._id, name: p.name })
    setPersonDialogOpen(true)
  }

  function openPayIn(p: PersonRow) {
    setPayDialogPerson({ id: p._id, name: p.name })
    setPayDialogMode('pay_in')
    setPayDialogOpen(true)
  }

  function openPayOut(p: PersonRow) {
    setPayDialogPerson({ id: p._id, name: p.name })
    setPayDialogMode('pay_out')
    setPayDialogOpen(true)
  }

  async function handleDeletePerson(p: PersonRow) {
    const result = await apiDelete(`/api/sophia/${p._id}`)
    if (result.success) {
      toast.success('Deleted')
      fetchPersons()
    } else toast.error(result.message)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sophia"
        description="China persons and RMB transactions."
        action={
          <Button onClick={openAddPerson}>
            <Plus className="mr-2 h-4 w-4" />
            Add New China Person
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-36 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
      ) : persons.length === 0 ? (
          <EmptyState
          icon={ArrowDownToLine}
          title="No China persons yet"
          description="Add China persons to track RMB pay in/out. The default person (e.g. Sophia) can be created from the first entry if needed."
        >
          <Button onClick={openAddPerson}>
            <Plus className="mr-2 h-4 w-4" />
            Add New China Person
          </Button>
        </EmptyState>
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {persons.map((p) => (
          <Card
            key={p._id}
            className={cn(
              'overflow-hidden transition-colors hover:bg-muted/50',
              p.currentBalance < 0 && 'border-destructive/50'
            )}
          >
            <Link href={`/sophia/${p._id}`} className="block">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  {p.isDefault && (
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">Default</span>
                  )}
                </div>
                <p className={cn('mt-2 text-2xl font-bold', p.currentBalance < 0 && 'text-destructive')}>
                  <AmountDisplay amount={p.currentBalance} currency="RMB" />
                </p>
                {p.currentBalance < 0 && (
                  <span className="mt-1 inline-block text-xs font-medium text-destructive">Negative balance</span>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  Pay In: {p.payInCount} | Payments made: {p.paymentsMadeCount}
                </p>
              </CardContent>
            </Link>
            <div className="flex gap-2 px-4 pb-4" onClick={(e) => e.preventDefault()}>
              <Button
                variant="outline"
                size="sm"
                className="text-green-600 hover:text-green-700"
                onClick={() => openPayIn(p)}
              >
                <ArrowDownToLine className="h-4 w-4 mr-1" />
                Pay In
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => openPayOut(p)}
              >
                <ArrowUpFromLine className="h-4 w-4 mr-1" />
                Pay Out
              </Button>
              {!p.isDefault && (
                <>
                  <Button variant="outline" size="sm" onClick={() => openEditPerson(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {p.payInCount === 0 && p.payOutCount === 0 ? (
                    <ConfirmDialog
                      title="Delete China person"
                      description="This cannot be undone."
                      confirmLabel="Delete"
                      variant="destructive"
                      onConfirm={() => handleDeletePerson(p)}
                      trigger={
                        <Button variant="outline" size="sm" className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      }
                    />
                  ) : null}
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
      )}

      <ChinaPersonDialog
        open={personDialogOpen}
        onOpenChange={setPersonDialogOpen}
        onSuccess={() => { fetchPersons(); setEditingPerson(null) }}
        editPerson={editingPerson}
      />

      {payDialogPerson && payDialogMode === 'pay_in' && (
        <PayInOutDialog
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={fetchPersons}
          personId={payDialogPerson.id}
          personName={payDialogPerson.name}
          mode="pay_in"
        />
      )}
      {payDialogPerson && payDialogMode === 'pay_out' && (
        <SophiaPayOutDialog
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={fetchPersons}
          personId={payDialogPerson.id}
          personName={payDialogPerson.name}
        />
      )}
    </div>
  )
}
