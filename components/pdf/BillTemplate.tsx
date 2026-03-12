import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Image,
} from '@react-pdf/renderer'
import { formatBillNumber } from '@/lib/utils'

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 10,
    fontFamily: 'Helvetica',
    backgroundColor: '#ffffff',
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  logoSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 48,
    height: 48,
    marginRight: 12,
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
  companyPhone: {
    fontSize: 8,
    color: '#6b7280',
  },
  companyGstin: {
    fontSize: 8,
    color: '#6b7280',
  },
  billInfo: {
    alignItems: 'flex-end',
  },
  billTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  billNumberText: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 4,
  },
  billDate: {
    fontSize: 10,
    color: '#6b7280',
  },
  // Bill to section
  toSection: {
    marginBottom: 16,
  },
  toLabel: {
    fontSize: 8,
    color: '#9ca3af',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  toName: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  // Table
  table: {
    marginBottom: 16,
  },
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
  colNo: {
    width: '5%',
    fontSize: 9,
    color: '#6b7280',
  },
  colProduct: {
    width: '35%',
    fontSize: 9,
  },
  colCtnPcs: {
    width: '20%',
    fontSize: 9,
    textAlign: 'center',
  },
  colRate: {
    width: '20%',
    fontSize: 9,
    textAlign: 'right',
  },
  colTotal: {
    width: '20%',
    fontSize: 9,
    textAlign: 'right',
  },
  colHeader: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: '#374151',
  },
  // Totals
  totalsSection: {
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 9,
    color: '#6b7280',
    width: 120,
    textAlign: 'right',
    marginRight: 16,
  },
  totalValue: {
    fontSize: 9,
    width: 120,
    textAlign: 'right',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1.5,
    borderTopColor: '#111827',
  },
  grandTotalLabel: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    width: 120,
    textAlign: 'right',
    marginRight: 16,
  },
  grandTotalValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    width: 140,
    textAlign: 'right',
  },
  // Outstanding box
  outstandingBox: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  outstandingLabel: {
    fontSize: 9,
    color: '#92400e',
  },
  outstandingValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#92400e',
  },
  // Footer
  footer: {
    marginTop: 'auto',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 8,
    color: '#9ca3af',
  },
})

const formatINR = (n: number | undefined | null): string =>
  'Rs ' +
  (Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const formatDate = (d: string | Date | undefined | null): string => {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export interface BillTemplateProps {
  bill: {
    billNumber: number
    billDate: string
    totalAmount: number
    extraCharges?: number
    extraChargesNote?: string
    discount?: number
    discountNote?: string
    grandTotal?: number
    isCashbook?: boolean
    company?: {
      companyName?: string
      ownerName?: string
      contact1Mobile?: string
      contact2Mobile?: string
      address?: string
      city?: string
    } | null
    items: {
      product?: { productName?: string }
      ctnSold: number
      pcsSold: number
      ratePerPcs: number
      totalAmount: number
    }[]
  }
  yourCompanyName?: string
  yourAddress?: string
  yourPhone?: string
  companyOutstanding?: number
}

export function BillTemplate({
  bill,
  yourCompanyName = '',
  yourAddress = '',
  yourPhone = '',
  companyOutstanding,
}: BillTemplateProps) {
  const company = bill.company ?? ({} as {
    companyName?: string
    ownerName?: string
    contact1Mobile?: string
    contact2Mobile?: string
    address?: string
    city?: string
  })

  const toMobile =
    [company.contact1Mobile, company.contact2Mobile]
      .filter(Boolean)
      .join(', ') || '—'

  const displayBillNumber = formatBillNumber(bill.billNumber, bill.billDate)
  const billDateStr = formatDate(bill.billDate)

  const headerCompanyName = yourCompanyName || process.env.COMPANY_NAME || ''
  const headerAddress = yourAddress || process.env.COMPANY_ADDRESS || ''
  const headerPhone = yourPhone || process.env.COMPANY_PHONE || ''
  const headerGstin = process.env.COMPANY_GSTIN || ''

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            {/* Optional logo; ensure the referenced file exists in your project */}
            <Image style={styles.logo} src="/public/logo.svg" />
            <View>
              {headerCompanyName ? (
                <Text style={styles.companyName}>{headerCompanyName}</Text>
              ) : null}
              {headerAddress ? (
                <Text style={styles.companyAddress}>{headerAddress}</Text>
              ) : null}
              {headerPhone ? (
                <Text style={styles.companyPhone}>📞 {headerPhone}</Text>
              ) : null}
              {headerGstin && headerGstin !== 'N/A' ? (
                <Text style={styles.companyGstin}>GSTIN: {headerGstin}</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.billInfo}>
            {/* Intentionally no hard-coded title like "INVOICE" */}
            <Text style={styles.billNumberText}>{displayBillNumber}</Text>
            <Text style={styles.billDate}>{billDateStr}</Text>
          </View>
        </View>

        {/* BILL TO */}
        <View style={styles.toSection}>
          <Text style={styles.toLabel}>Bill To</Text>
          <Text style={styles.toName}>
            {bill.isCashbook ? 'Cash Sale' : company.companyName ?? '—'}
          </Text>
          {company.address ? (
            <Text style={styles.companyAddress}>{company.address}</Text>
          ) : null}
          {toMobile ? (
            <Text style={styles.companyAddress}>📞 {toMobile}</Text>
          ) : null}
        </View>

        {/* ITEMS TABLE */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colNo, styles.colHeader]}>#</Text>
            <Text style={[styles.colProduct, styles.colHeader]}>Product</Text>
            <Text style={[styles.colCtnPcs, styles.colHeader]}>CTN / PCS</Text>
            <Text style={[styles.colRate, styles.colHeader]}>Rate/Pc</Text>
            <Text style={[styles.colTotal, styles.colHeader]}>Total</Text>
          </View>
          {bill.items.map((item, i) => {
            const rowStyle = i % 2 === 0 ? styles.tableRow : styles.tableRowAlt
            const productName =
              (item.product as { productName?: string })?.productName ?? ''
            return (
              <View key={i} style={rowStyle}>
                <Text style={styles.colNo}>{i + 1}</Text>
                <Text style={styles.colProduct}>{productName}</Text>
                <Text style={styles.colCtnPcs}>
                  {String(item.ctnSold ?? 0)} CTN / {String(item.pcsSold ?? 0)} PCS
                </Text>
                <Text style={styles.colRate}>{formatINR(item.ratePerPcs)}</Text>
                <Text style={styles.colTotal}>{formatINR(item.totalAmount)}</Text>
              </View>
            )
          })}
        </View>

        {/* TOTALS */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatINR(bill.totalAmount)}
            </Text>
          </View>
          {bill.extraCharges != null && bill.extraCharges > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                Extra Charges
                {bill.extraChargesNote
                  ? ` (${bill.extraChargesNote})`
                  : ''}
              </Text>
              <Text style={styles.totalValue}>
                +{formatINR(bill.extraCharges)}
              </Text>
            </View>
          )}
          {bill.discount != null && bill.discount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                Discount
                {bill.discountNote ? ` (${bill.discountNote})` : ''}
              </Text>
              <Text
                style={[
                  styles.totalValue,
                  { color: '#16a34a' },
                ]}
              >
                -{formatINR(bill.discount)}
              </Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Grand Total</Text>
            <Text style={styles.grandTotalValue}>
              {formatINR(bill.grandTotal ?? bill.totalAmount)}
            </Text>
          </View>
        </View>

        {/* OUTSTANDING BOX — only for company bills when provided */}
        {!bill.isCashbook &&
          typeof companyOutstanding === 'number' && (
            <View style={styles.outstandingBox}>
              <Text style={styles.outstandingLabel}>
                Current Outstanding Balance
              </Text>
              <Text style={styles.outstandingValue}>
                {formatINR(companyOutstanding)}
              </Text>
            </View>
          )}

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Thank you for your business!</Text>
          <Text style={styles.footerText}>
            {displayBillNumber}
            {billDateStr ? ` • ${billDateStr}` : ''}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
