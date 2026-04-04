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
    textTransform: 'uppercase',
  },
  // Bill to section
  toSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  billInfo: {
    alignItems: 'flex-end',
  },
  billNoText: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  billDateText: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 4,
  },
  companyAddress: {
    fontSize: 8,
    color: '#6b7280',
    marginTop: 2,
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
    width: '10%',
    fontSize: 9,
    color: '#6b7280',
  },
  colProduct: {
    width: '30%',
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  outstandingLabel: {
    fontSize: 9,
    color: '#000000',
  },
  outstandingValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#000000',
  },
  outstandingFooterText: {
    fontSize: 8,
    color: '#6b7280',
    textAlign: 'right',
  },
})

const formatINR = (n: number | undefined | null): string =>
  Math.round(Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }) + '/-'

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
      indiaProduct?: { productName?: string }
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
        {/* BILL TO */}
        <View style={styles.toSection}>
          <View>
            <Text style={styles.toLabel}>Bill To</Text>
            <Text style={styles.toName}>
              {bill.isCashbook ? 'Cash Sale' : company.companyName ?? '—'}
            </Text>
          </View>
          <View style={styles.billInfo}>
            <Text style={styles.billNoText}>INVOICE NO: {displayBillNumber}</Text>
            <Text style={styles.billDateText}>DATE: {billDateStr}</Text>
          </View>
        </View>

        {/* ITEMS TABLE */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colNo, styles.colHeader]}>SR. NO.</Text>
            <Text style={[styles.colProduct, styles.colHeader]}>PRODUCT</Text>
            <Text style={[styles.colCtnPcs, styles.colHeader]}>QUANTITY</Text>
            <Text style={[styles.colRate, styles.colHeader]}>RATE</Text>
            <Text style={[styles.colTotal, styles.colHeader]}>AMOUNT</Text>
          </View>
          {bill.items.map((item, i) => {
            const rowStyle = i % 2 === 0 ? styles.tableRow : styles.tableRowAlt
            const productName =
              (item.product as { productName?: string })?.productName ??
              (item.indiaProduct as { productName?: string })?.productName ??
              ''
            return (
              <View key={i} style={rowStyle}>
                <Text style={styles.colNo}>{i + 1}</Text>
                <Text style={styles.colProduct}>{productName}</Text>
                <Text style={styles.colCtnPcs}>
                  {String(item.pcsSold ?? 0)}
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
        {!bill.isCashbook && typeof companyOutstanding === 'number' && (
          <View style={{ marginTop: 'auto' }}>
            <View style={styles.outstandingBox}>
              <Text style={styles.outstandingLabel}>CURRENT OUTSTANDING BALANCE</Text>
              <Text style={styles.outstandingValue}>{formatINR(companyOutstanding)}</Text>
            </View>
            <Text style={styles.outstandingFooterText}>
              AS ON PRINTED DATE AND TIME: {formatDate(new Date())}, {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
