'use client'

import { FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportTableToPdf } from '@/lib/exportPdf'

interface ExportPdfButtonProps {
  title: string
  columns: string[]
  rows: (string | number)[][]
  filename?: string
  landscape?: boolean
  disabled?: boolean
}

export function ExportPdfButton({
  title,
  columns,
  rows,
  filename,
  landscape,
  disabled,
}: ExportPdfButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || rows.length === 0}
      onClick={() => exportTableToPdf({ title, columns, rows, filename, landscape })}
      className="gap-2"
    >
      <FileDown className="h-4 w-4" />
      Export PDF
    </Button>
  )
}

