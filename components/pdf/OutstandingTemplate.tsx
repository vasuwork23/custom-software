import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 20, fontSize: 10, fontFamily: 'Helvetica', textTransform: 'uppercase' },
  companyAddress: { fontSize: 8, color: '#6b7280', marginTop: 2 },
  companyPhone: { fontSize: 8, color: '#6b7280' },
  table: { marginBottom: 16 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fafafa',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  colHeader: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#374151' },
})

const formatINR = (n: number | undefined | null): string =>
  Math.round(Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }) + '/-'

const formatRate = (n: number | undefined | null): string => {
  const val = Number(n) || 0
  const hasDecimal = val % 1 !== 0
  return val.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }) + '/-'
}

const formatDate = (d: string | Date | null | undefined): string => {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime?.() ?? NaN)) return ''
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export interface OutstandingTemplateProps {
  company: {
    companyName: string
    address?: string
    mobile?: string
    ownerName?: string
    contact1Mobile?: string
    contact1Name?: string
    openingBalance?: number
    openingBalanceNotes?: string
  }
  transactions: {
    date: string | Date
    description: string
    debit?: number | null
    credit?: number | null
    balance: number
    items?: {
      productName: string
      ctnSold: number
      pcsSold: number
      ratePerPcs: number
    }[]
  }[]
  generatedDate: Date | string
  yourCompanyName?: string
  yourAddress?: string
  yourPhone?: string
}

// Estimated heights in pt (A4 usable = ~802pt)
const FIRST_PAGE_BUDGET = 580  // less due to title + info header + opening balance row
const PAGE_BUDGET = 700        // continued pages (includes table header + contd header)
const MAIN_ROW_H = 24          // paddingVertical:6*2 + ~10pt font + 2pt wrapper margin
const ITEM_ROW_H = 15          // paddingVertical:3*2 + ~8pt font + 1pt border

function TableHeader() {
  return (
    <View style={styles.tableHeader}>
      <Text style={[{ width: '15%' }, styles.colHeader]}>Date</Text>
      <Text style={[{ width: '40%' }, styles.colHeader]}>Description</Text>
      <Text style={[{ width: '15%', textAlign: 'right' }, styles.colHeader]}>Debit</Text>
      <Text style={[{ width: '15%', textAlign: 'right' }, styles.colHeader]}>Credit</Text>
      <Text style={[{ width: '15%', textAlign: 'right' }, styles.colHeader]}>Balance</Text>
    </View>
  )
}

function TransactionRow({ tx, i }: { tx: OutstandingTemplateProps['transactions'][0]; i: number }) {
  return (
    <View style={{ marginBottom: 2 }}>
      <View style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
        <Text style={{ width: '15%', fontSize: 9 }}>{formatDate(tx.date)}</Text>
        <Text style={{ width: '40%', fontSize: 9, fontFamily: 'Helvetica-Bold' }}>
          {String(tx.description || '')}
        </Text>
        <Text style={{ width: '15%', fontSize: 9, textAlign: 'right', color: tx.debit ? '#dc2626' : '#9ca3af' }}>
          {tx.debit ? formatINR(tx.debit) : '—'}
        </Text>
        <Text style={{ width: '15%', fontSize: 9, textAlign: 'right', color: tx.credit ? '#16a34a' : '#9ca3af' }}>
          {tx.credit ? formatINR(tx.credit) : '—'}
        </Text>
        <Text style={{ width: '15%', fontSize: 9, textAlign: 'right', fontFamily: 'Helvetica-Bold', color: tx.balance < 0 ? '#16a34a' : '#111827' }}>
          {formatINR(Math.abs(tx.balance))}{tx.balance < 0 ? ' CR' : ''}
        </Text>
      </View>
      {tx.items && tx.items.length > 0 && tx.items.map((item, j) => (
        <View
          key={j}
          style={{
            flexDirection: 'row',
            paddingVertical: 3,
            paddingHorizontal: 8,
            paddingLeft: 20,
            backgroundColor: '#f9fafb',
            borderBottomWidth: 1,
            borderBottomColor: '#f3f4f6',
          }}
        >
          <Text style={{ width: '15%', fontSize: 8, color: '#9ca3af' }}>{''}</Text>
          <Text style={{ width: '40%', fontSize: 8, color: '#374151' }}>{item.productName}</Text>
          <Text style={{ width: '15%', fontSize: 8, color: '#374151', textAlign: 'right' }}>
            {item.pcsSold > 0 ? `${item.pcsSold} PCS` : '-'}
          </Text>
          <Text style={{ width: '15%', fontSize: 8, color: '#374151', textAlign: 'right' }}>
            {'@ '}{formatRate(item.ratePerPcs)}
          </Text>
          <Text style={{ width: '15%', fontSize: 8, color: '#9ca3af', textAlign: 'right' }}>{''}</Text>
        </View>
      ))}
    </View>
  )
}

export function OutstandingTemplate({
  company,
  transactions,
  generatedDate,
  yourCompanyName = '',
  yourAddress = '',
  yourPhone = '',
}: OutstandingTemplateProps) {
  const genDate = generatedDate instanceof Date ? generatedDate : new Date(generatedDate)
  const generatedAtStr = formatDate(genDate)
  const generatedAtTime = genDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const headerCompanyName = yourCompanyName || process.env.COMPANY_NAME || ''

  const currentOutstanding =
    transactions.length > 0
      ? transactions[transactions.length - 1].balance
      : (company.openingBalance || 0)

  // Chunk by estimated pt height so each chunk fills its A4 page without overflow
  const chunks: OutstandingTemplateProps['transactions'][] = []
  let currentChunk: OutstandingTemplateProps['transactions'] = []
  let currentHeight = 0
  let firstPage = true

  for (const tx of transactions) {
    const budget = firstPage ? FIRST_PAGE_BUDGET : PAGE_BUDGET
    const txH = MAIN_ROW_H + (tx.items?.length || 0) * ITEM_ROW_H
    if (currentHeight + txH > budget && currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = []
      currentHeight = 0
      firstPage = false
    }
    currentChunk.push(tx)
    currentHeight += txH
  }
  if (currentChunk.length > 0) chunks.push(currentChunk)
  if (chunks.length === 0) chunks.push([])

  const totalPages = chunks.length

  return (
    <Document>
      {chunks.map((chunk, pageIndex) => {
        const isFirstPage = pageIndex === 0
        const isLastPage = pageIndex === totalPages - 1

        return (
          <Page key={pageIndex} size="A4" style={styles.page}>
            {/* Header — only on first page */}
            {isFirstPage && (
              <>
                <View style={{ alignItems: 'center', marginBottom: 16 }}>
                  <Text style={{ fontSize: 15, fontFamily: 'Times-Bold', color: '#111827', letterSpacing: 0.5 }}>
                    ACCOUNT LEDGER
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                  <View>
                    <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
                      {company.companyName}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 10, color: '#6b7280' }}>DATE: {generatedAtStr}, {generatedAtTime}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Continued header for subsequent pages */}
            {!isFirstPage && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{company.companyName} — ACCOUNT LEDGER (contd.)</Text>
                <Text style={{ fontSize: 8, color: '#6b7280' }}>Page {pageIndex + 1} of {totalPages}</Text>
              </View>
            )}

            {/* Table */}
            <View style={styles.table}>
              <TableHeader />

              {/* Opening balance row — only on first page */}
              {isFirstPage && (
                <View style={[styles.tableRow, { backgroundColor: '#eff6ff' }]}>
                  <Text style={{ width: '15%', fontSize: 9 }}>—</Text>
                  <Text style={{ width: '40%', fontSize: 9, fontFamily: 'Helvetica-Bold' }}>
                    {company.openingBalanceNotes || 'Opening Balance'}
                  </Text>
                  <Text style={{ width: '15%', fontSize: 9, textAlign: 'right', color: (company.openingBalance || 0) > 0 ? '#dc2626' : '#9ca3af' }}>
                    {(company.openingBalance || 0) > 0 ? formatINR(company.openingBalance || 0) : '—'}
                  </Text>
                  <Text style={{ width: '15%', fontSize: 9, textAlign: 'right', color: (company.openingBalance || 0) < 0 ? '#16a34a' : '#9ca3af' }}>
                    {(company.openingBalance || 0) < 0 ? formatINR(Math.abs(company.openingBalance || 0)) : '—'}
                  </Text>
                  <Text style={{ width: '15%', fontSize: 9, textAlign: 'right', fontFamily: 'Helvetica-Bold', color: (company.openingBalance || 0) < 0 ? '#16a34a' : '#111827' }}>
                    {formatINR(Math.abs(company.openingBalance || 0))}
                    {(company.openingBalance || 0) < 0 ? ' CR' : ''}
                  </Text>
                </View>
              )}

              {chunk.map((tx, i) => (
                <TransactionRow key={i} tx={tx} i={i} />
              ))}
            </View>

            {/* Summary box — only on last page */}
            {isLastPage && (
              <View style={{ marginTop: 16 }}>
                <View style={{
                  backgroundColor: '#ffffff',
                  borderWidth: 1,
                  borderColor: '#000000',
                  borderRadius: 6,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  marginBottom: 4,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <Text style={{ fontSize: 10, color: '#000000' }}>
                    {currentOutstanding > 0 ? 'Current Outstanding' : currentOutstanding < 0 ? 'Advance Balance' : 'Balance Clear ✓'}
                  </Text>
                  <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#000000' }}>
                    {formatINR(Math.abs(currentOutstanding))}
                    {currentOutstanding < 0 ? ' (ADVANCE)' : ''}
                  </Text>
                </View>
                <Text style={{ fontSize: 8, color: '#6b7280', textAlign: 'right' }}>
                  AS ON PRINTED DATE AND TIME: {formatDate(new Date())}, {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            )}
          </Page>
        )
      })}
    </Document>
  )
}
