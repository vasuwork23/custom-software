import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import {
  STOCK_COLUMNS,
  ALL_STOCK_COLUMN_KEYS,
  formatStockCell,
  stockTotals,
  type StockColumnKey,
  type StockReportRow,
} from '@/lib/stock-report-columns'

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

// Wrap long names at spaces only; the default hyphenation splits words like "Chi-na".
Font.registerHyphenationCallback((word) => [word])

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
const stockPdfStyles = StyleSheet.create({
  stockCell: { flex: 1, textAlign: 'right', paddingHorizontal: 2 },
  stockNameCell: { flex: 2.4, paddingHorizontal: 2 },
  totalRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#333', paddingVertical: 4, fontWeight: 'bold' },
  summaryHeading: { fontSize: 10, color: '#444', marginBottom: 4 },
  summaryCard: { width: '15.5%', marginRight: '1%', marginBottom: 6, padding: 6, backgroundColor: '#f5f5f5' },
})

/** A stock row as the API sends it: the report columns plus the warehouse figures used by the summary cards. */
type StockPdfRow = StockReportRow & {
  chinaWarehouse?: number
  inTransit?: number
  availablePcs?: number
  totalCost?: number
}

/** Helvetica has no flag emoji, so drop them rather than print boxes. */
function pdfText(v: string): string {
  return v.replace(/\uD83C[\uDDE6-\uDDFF]/g, '').replace(/\s{2,}/g, ' ').trim()
}

function StockTable({ title, rows, columns }: { title: string; rows: StockReportRow[]; columns: StockColumnKey[] }) {
  const cols = STOCK_COLUMNS.filter((c) => columns.includes(c.key))
  const styleFor = (key: StockColumnKey) =>
    key === 'productName' ? stockPdfStyles.stockNameCell : stockPdfStyles.stockCell
  const totals = stockTotals(rows)
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {/* fixed: repeats at the top of every page this table runs onto. Each table
          gets its own <Page>, so one table's header never shows on the other's pages. */}
      <View style={styles.headerRow} fixed>
        {cols.map((c) => (
          <Text key={c.key} style={styleFor(c.key)}>{c.label}</Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.row} wrap={false}>
          {cols.map((c) => (
            <Text key={c.key} style={styleFor(c.key)}>{pdfText(formatStockCell(c.key, r[c.key], 'Rs '))}</Text>
          ))}
        </View>
      ))}
      {rows.length > 0 && (
        <View style={stockPdfStyles.totalRow} wrap={false}>
          {cols.map((c) => (
            <Text key={c.key} style={styleFor(c.key)}>{pdfText(formatStockCell(c.key, totals[c.key], 'Rs '))}</Text>
          ))}
        </View>
      )}
    </View>
  )
}

export function StockPdfDocument({
  data,
  columns = ALL_STOCK_COLUMN_KEYS,
}: {
  data: {
    rows: StockPdfRow[]
    indiaRows?: StockPdfRow[]
  }
  columns?: StockColumnKey[]
}) {
  const rows = data.rows ?? []
  const indiaRows = data.indiaRows ?? []
  // Worked out from the rows (not the API summary) so the cards match the
  // filtered rows in the PDF, the same way the on-screen cards do.
  const sum = (list: StockPdfRow[], k: 'chinaWarehouse' | 'inTransit' | 'availableCtn' | 'availablePcs' | 'totalCost') =>
    list.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const fmtCtn = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const chinaValue = sum(rows, 'totalCost')
  const indiaValue = sum(indiaRows, 'totalCost')

  const card = (label: string, value: string) => (
    <View key={label} style={stockPdfStyles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>Stock Report</Text>
        <Text style={stockPdfStyles.summaryHeading}>China Products</Text>
        <View style={styles.summaryGrid}>
          {card('Products', fmtNum(rows.length))}
          {card('In China (CTN)', fmtCtn(sum(rows, 'chinaWarehouse')))}
          {card('In Transit (CTN)', fmtCtn(sum(rows, 'inTransit')))}
          {card('Available India (CTN)', fmtCtn(sum(rows, 'availableCtn')))}
          {card('Available PCS', fmtNum(sum(rows, 'availablePcs')))}
          {card('Stock Valuation', `Rs ${fmtNum(chinaValue)}`)}
        </View>
        {indiaRows.length > 0 && (
          <>
            <Text style={stockPdfStyles.summaryHeading}>India Products</Text>
            <View style={styles.summaryGrid}>
              {card('Products', fmtNum(indiaRows.length))}
              {card('Available (CTN)', fmtCtn(sum(indiaRows, 'availableCtn')))}
              {card('Available PCS', fmtNum(sum(indiaRows, 'availablePcs')))}
              {card('Stock Valuation', `Rs ${fmtNum(indiaValue)}`)}
            </View>
          </>
        )}
        <View style={styles.summaryGrid}>
          {card('Total Stock Valuation', `Rs ${fmtNum(chinaValue + indiaValue)}`)}
        </View>
        <StockTable title="China Products" rows={rows} columns={columns} />
      </Page>
      {indiaRows.length > 0 && (
        <Page size="A4" orientation="landscape" style={styles.page}>
          <StockTable title="India Products" rows={indiaRows} columns={columns} />
        </Page>
      )}
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
