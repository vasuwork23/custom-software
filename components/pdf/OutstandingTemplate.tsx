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
  page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica' },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  logoSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 40,
    height: 40,
    marginRight: 10,
  },
  companyName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  companyAddress: {
    fontSize: 8,
    color: '#6b7280',
    marginTop: 2,
  },
  companyPhone: { fontSize: 8, color: '#6b7280' },
  billInfo: { alignItems: 'flex-end' },
  billTitle: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  billDate: { fontSize: 10, color: '#6b7280', marginTop: 4 },
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
  // Footer
  footer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 8, color: '#9ca3af' },
})

const formatINR = (n: number | undefined | null): string =>
  'Rs ' +
  (Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

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
  }
  /** Full statement transactions with running balance. */
  transactions: {
    date: string | Date
    description: string
    debit?: number | null
    credit?: number | null
    balance: number
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
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            <Image style={styles.logo} src="/public/logo.svg" />
            <View>
              {headerCompanyName ? (
                <Text style={styles.companyName}>{headerCompanyName}</Text>
              ) : null}
              {headerAddress ? (
                <Text style={styles.companyAddress}>{headerAddress}</Text>
              ) : null}
              {headerPhone ? (
                <Text style={styles.companyPhone}>{headerPhone}</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.billInfo}>
            <Text style={styles.billTitle}>ACCOUNT STATEMENT</Text>
            <Text style={styles.billDate}>
              Generated: {generatedAtStr}
            </Text>
          </View>
        </View>

        {/* COMPANY INFO */}
        <View
          style={{
            marginBottom: 16,
            paddingVertical: 8,
            paddingHorizontal: 12,
            backgroundColor: '#f9fafb',
            borderRadius: 6,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'Helvetica-Bold',
            }}
          >
            {company.companyName}
          </Text>
          {company.address ? (
            <Text
              style={{
                fontSize: 9,
                color: '#6b7280',
                marginTop: 2,
              }}
            >
              {company.address}
            </Text>
          ) : null}
          {mobile ? (
            <Text
              style={{
                fontSize: 9,
                color: '#6b7280',
              }}
            >
              📞 {mobile}
            </Text>
          ) : null}
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
              Debit (₹)
            </Text>
            <Text
              style={[
                { width: '15%', textAlign: 'right' },
                styles.colHeader,
              ]}
            >
              Credit (₹)
            </Text>
            <Text
              style={[
                { width: '15%', textAlign: 'right' },
                styles.colHeader,
              ]}
            >
              Balance (₹)
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
              Opening Balance
            </Text>
            <Text
              style={{
                width: '15%',
                fontSize: 9,
                textAlign: 'right',
              }}
            >
              —
            </Text>
            <Text
              style={{
                width: '15%',
                fontSize: 9,
                textAlign: 'right',
              }}
            >
              —
            </Text>
            <Text
              style={{
                width: '15%',
                fontSize: 9,
                textAlign: 'right',
                fontFamily: 'Helvetica-Bold',
              }}
            >
              ₹0.00
            </Text>
          </View>

          {transactions.map((tx, i) => (
            <View
              key={i}
              style={
                i % 2 === 0
                  ? styles.tableRow
                  : styles.tableRowAlt
              }
            >
              <Text
                style={{ width: '15%', fontSize: 9 }}
              >
                {formatDate(tx.date)}
              </Text>
              <Text
                style={{ width: '40%', fontSize: 9 }}
              >
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
          ))}
        </View>

        {/* SUMMARY BOX */}
        <View
          style={{
            backgroundColor:
              currentOutstanding > 0
                ? '#fef3c7'
                : '#f0fdf4',
            borderWidth: 1,
            borderColor:
              currentOutstanding > 0
                ? '#f59e0b'
                : '#16a34a',
            borderRadius: 6,
            paddingVertical: 10,
            paddingHorizontal: 14,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 10,
              color: '#374151',
            }}
          >
            {currentOutstanding > 0
              ? 'Total Outstanding'
              : 'Balance Clear ✓'}
          </Text>
          <Text
            style={{
              fontSize: 14,
              fontFamily: 'Helvetica-Bold',
              color:
                currentOutstanding > 0
                  ? '#92400e'
                  : '#15803d',
            }}
          >
            {formatINR(Math.abs(currentOutstanding))}
            {currentOutstanding <= 0 ? ' (Advance)' : ''}
          </Text>
        </View>

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            This is a computer generated statement.
          </Text>
          <Text style={styles.footerText}>
            Generated on {generatedAtStr}
          </Text>
        </View>
      </Page>
    </Document>
  )
}

