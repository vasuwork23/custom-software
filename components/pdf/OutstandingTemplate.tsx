import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Image,
} from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 20, fontSize: 10, fontFamily: 'Helvetica', textTransform: 'uppercase' },
  // Header
  companyAddress: {
    fontSize: 8,
    color: '#6b7280',
    marginTop: 2,
  },
  companyPhone: { fontSize: 8, color: '#6b7280' },
  // Table
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
  colHeader: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: '#374151',
  },

})

const formatINR = (n: number | undefined | null): string =>
  Math.round(Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }) + '/-'

const formatDate = (d: string | Date | null | undefined): string => {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime?.() ?? NaN)) return ''
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
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
  /** Full statement transactions with running balance. */
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

export function OutstandingTemplate({
  company,
  transactions,
  generatedDate,
  yourCompanyName = '',
  yourAddress = '',
  yourPhone = '',
}: OutstandingTemplateProps) {
  const generatedAtStr = formatDate(generatedDate)
  const headerCompanyName =
    yourCompanyName || process.env.COMPANY_NAME || ''
  const headerAddress =
    yourAddress || process.env.COMPANY_ADDRESS || ''
  const headerPhone =
    yourPhone || process.env.COMPANY_PHONE || ''

  const mobile =
    company.mobile ||
    company.contact1Mobile ||
    ''

  const currentOutstanding =
    transactions.length > 0
      ? transactions[transactions.length - 1].balance
      : 0

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* INFO SECTION */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
              {company.companyName}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#111827' }}>ACCOUNT STATEMENT</Text>
            <Text style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>DATE: {generatedAtStr}</Text>
          </View>
        </View>

        {/* TRANSACTIONS TABLE */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[{ width: '15%' }, styles.colHeader]}>Date</Text>
            <Text style={[{ width: '40%' }, styles.colHeader]}>
              Description
            </Text>
            <Text
              style={[
                { width: '15%', textAlign: 'right' },
                styles.colHeader,
              ]}
            >
              Debit
            </Text>
            <Text
              style={[
                { width: '15%', textAlign: 'right' },
                styles.colHeader,
              ]}
            >
              Credit
            </Text>
            <Text
              style={[
                { width: '15%', textAlign: 'right' },
                styles.colHeader,
              ]}
            >
              Balance
            </Text>
          </View>

          {/* Opening balance row */}
          <View
            style={[
              styles.tableRow,
              { backgroundColor: '#eff6ff' },
            ]}
          >
            <Text style={{ width: '15%', fontSize: 9 }}>—</Text>
            <Text
              style={{
                width: '40%',
                fontSize: 9,
                fontFamily: 'Helvetica-Bold',
              }}
            >
              {company.openingBalanceNotes || 'Opening Balance'}
            </Text>
            <Text
              style={{
                width: '15%',
                fontSize: 9,
                textAlign: 'right',
                color: (company.openingBalance || 0) > 0 ? '#dc2626' : '#9ca3af',
              }}
            >
              {(company.openingBalance || 0) > 0 ? formatINR(company.openingBalance || 0) : '—'}
            </Text>
            <Text
              style={{
                width: '15%',
                fontSize: 9,
                textAlign: 'right',
                color: (company.openingBalance || 0) < 0 ? '#16a34a' : '#9ca3af',
              }}
            >
              {(company.openingBalance || 0) < 0 ? formatINR(Math.abs(company.openingBalance || 0)) : '—'}
            </Text>
            <Text
              style={{
                width: '15%',
                fontSize: 9,
                textAlign: 'right',
                fontFamily: 'Helvetica-Bold',
                color: (company.openingBalance || 0) < 0 ? '#16a34a' : '#111827',
              }}
            >
              {formatINR(Math.abs(company.openingBalance || 0))}
              {(company.openingBalance || 0) < 0 ? ' CR' : ''}
            </Text>
          </View>

          {transactions.map((tx, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              {/* Main invoice / payment row */}
              <View
                style={
                  i % 2 === 0
                    ? styles.tableRow
                    : styles.tableRowAlt
                }
              >
                <Text style={{ width: '15%', fontSize: 9 }}>
                  {formatDate(tx.date)}
                </Text>
                <Text style={{ width: '40%', fontSize: 9, fontFamily: 'Helvetica-Bold' }}>
                  {String(tx.description || '')}
                </Text>
                <Text
                  style={{
                    width: '15%',
                    fontSize: 9,
                    textAlign: 'right',
                    color: tx.debit ? '#dc2626' : '#9ca3af',
                  }}
                >
                  {tx.debit ? formatINR(tx.debit) : '—'}
                </Text>
                <Text
                  style={{
                    width: '15%',
                    fontSize: 9,
                    textAlign: 'right',
                    color: tx.credit ? '#16a34a' : '#9ca3af',
                  }}
                >
                  {tx.credit ? formatINR(tx.credit) : '—'}
                </Text>
                <Text
                  style={{
                    width: '15%',
                    fontSize: 9,
                    textAlign: 'right',
                    fontFamily: 'Helvetica-Bold',
                    color:
                      tx.balance < 0
                        ? '#16a34a'
                        : '#111827',
                  }}
                >
                  {formatINR(Math.abs(tx.balance))}
                  {tx.balance < 0 ? ' CR' : ''}
                </Text>
              </View>

              {/* Product sub-rows (only for invoice entries) */}
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
                  <Text style={{ width: '40%', fontSize: 8, color: '#374151' }}>
                    {item.productName}
                  </Text>
                  <Text style={{ width: '15%', fontSize: 8, color: '#374151', textAlign: 'right' }}>
                    {item.pcsSold > 0 ? `${item.pcsSold} PCS` : '-'}
                  </Text>
                  <Text style={{ width: '15%', fontSize: 8, color: '#374151', textAlign: 'right' }}>
                    {'@ '}{formatINR(item.ratePerPcs)}
                  </Text>
                  <Text style={{ width: '15%', fontSize: 8, color: '#9ca3af', textAlign: 'right' }}>{''}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* SUMMARY BOX */}
        <View style={{ marginTop: 'auto' }}>
          <View
            style={{
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
            }}
          >
            <Text style={{ fontSize: 10, color: '#000000' }}>
              {currentOutstanding > 0 ? 'Total Outstanding' : 'Balance Clear ✓'}
            </Text>
            <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#000000' }}>
              {formatINR(Math.abs(currentOutstanding))}
              {currentOutstanding <= 0 ? ' (Advance)' : ''}
            </Text>
          </View>
          <Text style={{ fontSize: 8, color: '#6b7280', textAlign: 'right' }}>
            AS ON PRINTED DATE AND TIME: {formatDate(new Date())}, {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </Page>
    </Document>
  )
}

