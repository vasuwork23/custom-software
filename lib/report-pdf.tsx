import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10 },
  title: { fontSize: 16, marginBottom: 16, fontWeight: 'bold' },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, marginBottom: 6, fontWeight: 'bold' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ccc', paddingVertical: 4 },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#333', paddingVertical: 4, fontWeight: 'bold' },
  cell: { flex: 1 },
  cellRight: { flex: 1, textAlign: 'right' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  summaryCard: { width: '30%', marginRight: '3%', marginBottom: 8, padding: 8, backgroundColor: '#f5f5f5' },
  summaryLabel: { fontSize: 8, color: '#666' },
  summaryValue: { fontSize: 12, fontWeight: 'bold' },
})

function fmtNum(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)
}

/** Coerce any value to a string safe for React/PDF (never render an object). */
function safeStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return '—'
  return String(v)
}

// P&L
export function PnlPdfDocument({
  data,
}: {
  data: {
    summary: { revenue: number; cost: number; grossProfit: number; totalExpenses: number; netProfit: number; marginPct: number; netMarginPct: number }
    byProduct: { productName: string; revenue: number; cost: number; profit: number; marginPct: number }[]
    byCompany: { companyName: string; revenue: number; profit: number; outstanding: number }[]
  }
}) {
  const s = data.summary
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>P&amp;L Report</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Revenue</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.revenue)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Cost</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.cost)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Gross Profit</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.grossProfit)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Expenses</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.totalExpenses)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Net Profit</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.netProfit)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Margin %</Text><Text style={styles.summaryValue}>{s.marginPct.toFixed(2)}%</Text></View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>By Product</Text>
          <View style={styles.headerRow}>
            <Text style={styles.cell}>Product</Text>
            <Text style={styles.cellRight}>Revenue</Text>
            <Text style={styles.cellRight}>Cost</Text>
            <Text style={styles.cellRight}>Profit</Text>
            <Text style={styles.cellRight}>Margin %</Text>
          </View>
          {data.byProduct.slice(0, 30).map((r, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{r.productName}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(r.revenue)}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(r.cost)}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(r.profit)}</Text>
              <Text style={styles.cellRight}>{r.marginPct.toFixed(2)}%</Text>
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>By Company</Text>
          <View style={styles.headerRow}>
            <Text style={styles.cell}>Company</Text>
            <Text style={styles.cellRight}>Revenue</Text>
            <Text style={styles.cellRight}>Profit</Text>
            <Text style={styles.cellRight}>Outstanding</Text>
          </View>
          {data.byCompany.slice(0, 30).map((r, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{r.companyName}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(r.revenue)}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(r.profit)}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(r.outstanding)}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}

// Stock
export function StockPdfDocument({
  data,
}: {
  data: {
    summary: { totalProducts: number; totalAvailableCtn: number; totalInTransit: number; totalInChina: number; totalInIndia: number; totalIndiaProducts?: number; totalIndiaAvailableCtn?: number }
    rows: { productName: string; totalCtnBought: number; availableCtn: number; chinaWarehouse: number; inTransit: number; indiaWarehouse: number; lockedEntries: number }[]
    indiaRows?: { productName: string; totalCtnBought: number; availableCtn: number }[]
  }
}) {
  const s = data.summary
  const indiaRows = data.indiaRows ?? []
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Stock Report</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>China Products</Text>
            <Text style={styles.summaryValue}>{safeStr(s.totalProducts)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Available (China India WH)</Text>
            <Text style={styles.summaryValue}>{safeStr(s.totalInIndia)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>In Transit</Text>
            <Text style={styles.summaryValue}>{safeStr(s.totalInTransit)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>In China</Text>
            <Text style={styles.summaryValue}>{safeStr(s.totalInChina)}</Text>
          </View>
          {indiaRows.length > 0 && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>India Products</Text>
              <Text style={styles.summaryValue}>
                {safeStr(s.totalIndiaProducts ?? 0)}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>China Products</Text>
          <View style={styles.headerRow}>
            <Text style={styles.cell}>Product</Text>
            <Text style={styles.cellRight}>Total Bought</Text>
            <Text style={styles.cellRight}>Available</Text>
            <Text style={styles.cellRight}>China</Text>
            <Text style={styles.cellRight}>Transit</Text>
            <Text style={styles.cellRight}>India</Text>
            <Text style={styles.cellRight}>Locked</Text>
          </View>
          {data.rows.map((r, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{safeStr(r.productName)}</Text>
              <Text style={styles.cellRight}>{safeStr(r.totalCtnBought)}</Text>
              <Text style={styles.cellRight}>{safeStr(r.availableCtn)}</Text>
              <Text style={styles.cellRight}>{safeStr(r.chinaWarehouse)}</Text>
              <Text style={styles.cellRight}>{safeStr(r.inTransit)}</Text>
              <Text style={styles.cellRight}>{safeStr(r.indiaWarehouse)}</Text>
              <Text style={styles.cellRight}>{safeStr(r.lockedEntries)}</Text>
            </View>
          ))}
        </View>
        {indiaRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>India Products</Text>
            <View style={styles.headerRow}>
              <Text style={styles.cell}>Product</Text>
              <Text style={styles.cellRight}>Total Bought</Text>
              <Text style={styles.cellRight}>Available</Text>
            </View>
            {indiaRows.map((r, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.cell}>{safeStr(r.productName)}</Text>
                <Text style={styles.cellRight}>{safeStr(r.totalCtnBought)}</Text>
                <Text style={styles.cellRight}>{safeStr(r.availableCtn)}</Text>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  )
}

// Selling
export function SellingPdfDocument({
  data,
}: {
  data: {
    summary: { totalBills: number; totalRevenue: number; totalProfit: number; avgBillValue: number }
    bills: { billNumber: number; billDate: string; companyName: string; productCount: number; amount: number; profit: number }[]
  }
}) {
  const s = data.summary
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Selling Report</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Total Bills</Text><Text style={styles.summaryValue}>{s.totalBills}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Revenue</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.totalRevenue)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Profit</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.totalProfit)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Avg Bill</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.avgBillValue)}</Text></View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bills</Text>
          <View style={styles.headerRow}>
            <Text style={styles.cell}>Bill No</Text>
            <Text style={styles.cell}>Date</Text>
            <Text style={styles.cell}>Company</Text>
            <Text style={styles.cellRight}>Products</Text>
            <Text style={styles.cellRight}>Amount</Text>
            <Text style={styles.cellRight}>Profit</Text>
          </View>
          {data.bills.map((b, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{b.billNumber}</Text>
              <Text style={styles.cell}>{b.billDate}</Text>
              <Text style={styles.cell}>{b.companyName}</Text>
              <Text style={styles.cellRight}>{b.productCount}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(b.amount)}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(b.profit)}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}

// Buying
export function BuyingPdfDocument({
  data,
}: {
  data: {
    summary: { totalEntries: number; totalAmount: number; totalGiven: number; totalRemaining: number }
    entries: { entryDate: string; productName: string; totalCtn: number; totalAmount: number; givenAmount: number; remainingAmount: number; currentStatus: string }[]
  }
}) {
  const s = data.summary
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Buying Report</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Total Entries</Text><Text style={styles.summaryValue}>{s.totalEntries}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Invested</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.totalAmount)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Paid</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.totalGiven)}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Remaining</Text><Text style={styles.summaryValue}>Rs {fmtNum(s.totalRemaining)}</Text></View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Entries</Text>
          <View style={styles.headerRow}>
            <Text style={styles.cell}>Date</Text>
            <Text style={styles.cell}>Product</Text>
            <Text style={styles.cellRight}>CTN</Text>
            <Text style={styles.cellRight}>Total</Text>
            <Text style={styles.cellRight}>Given</Text>
            <Text style={styles.cellRight}>Remaining</Text>
            <Text style={styles.cell}>Status</Text>
          </View>
          {data.entries.map((e, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.cell}>{e.entryDate}</Text>
              <Text style={styles.cell}>{e.productName}</Text>
              <Text style={styles.cellRight}>{e.totalCtn}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(e.totalAmount)}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(e.givenAmount)}</Text>
              <Text style={styles.cellRight}>Rs {fmtNum(e.remainingAmount)}</Text>
              <Text style={styles.cell}>{e.currentStatus}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}
