import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface ExportPdfOptions {
  title: string
  columns: string[]
  rows: (string | number)[][]
  filename?: string
  landscape?: boolean
}

export function exportTableToPdf({
  title,
  columns,
  rows,
  filename,
  landscape = false,
}: ExportPdfOptions) {
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const pageWidth = doc.internal.pageSize.getWidth()
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 16)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120)
  doc.text(`Generated: ${today}`, pageWidth - 14, 16, { align: 'right' })
  doc.text(`Total: ${rows.length} records`, 14, 22)
  doc.setTextColor(0)

  autoTable(doc, {
    head: [columns],
    body: rows.map((row) => row.map((cell) => String(cell ?? ''))),
    startY: 26,
    styles: {
      fontSize: 8,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [30, 30, 30],
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 248, 248],
    },
    margin: { left: 14, right: 14 },
  })

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' }
    )
  }

  const safeName = filename || title.toLowerCase().replace(/\s+/g, '-')
  doc.save(`${safeName}-${Date.now()}.pdf`)
}

