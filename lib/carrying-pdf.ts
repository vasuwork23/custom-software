/**
 * Isolated Carrying module — PDF export.
 * Include: Container Name, Company Name, Product Name, Total CBM, Price (Sell/CBM), Total Amount.
 * Exclude: Price (Buy/CBM), Total Profit.
 * Footer: Sum Total CBM, Sum Total Amount.
 * Filename: Carrying_Bill_{ContainerName}_{Date}.pdf
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { CarryingBill } from './carrying-types'

function safeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') || 'Bill'
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).replace(/\//g, '-')
  } catch {
    return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
  }
}

export function exportCarryingBillToPdf(bill: CarryingBill): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14

  // Title
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Carrying Bill', margin, 16)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Container: ${bill.containerName}`, margin, 24)
  doc.text(`Company: ${bill.companyName}`, margin, 30)

  const columns = ['Product Name', 'Total CBM', 'Price (Sell/CBM)', 'Total Amount']
  const rows = bill.products.map((p) => [
    p.productName,
    String(Number(p.totalCBM)),
    String(Number(p.priceSellCBM)),
    String(Number(p.totalAmount)),
  ])

  const sumCBM = bill.products.reduce((s, p) => s + Number(p.totalCBM), 0)
  const sumAmount = bill.products.reduce((s, p) => s + Number(p.totalAmount), 0)

  autoTable(doc, {
    head: [columns],
    body: rows,
    startY: 36,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: margin, right: margin },
    didDrawPage: (data) => {
      // Footer with sums on last page
      if (data.pageNumber === data.pageCount) {
        const fy = data.cursor?.y ?? 36
        const footY = fy + 8
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.text(`Total CBM: ${sumCBM}`, margin, footY)
        doc.text(`Total Amount: ${sumAmount}`, margin, footY + 6)
      }
    },
  })

  const dateStr = formatDate(bill.updatedAt ?? bill.createdAt)
  const baseName = safeFilename(bill.containerName)
  const filename = `Carrying_Bill_${baseName}_${dateStr}.pdf`
  doc.save(filename)
}
