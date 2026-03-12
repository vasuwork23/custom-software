# UI Components & Pages Plan

## Instructions for Cursor
- Use shadcn/ui as component base
- Use Tailwind CSS for styling
- Dark/Light mode support via next-themes
- All pages inside (dashboard) layout have sidebar navigation
- Mobile responsive

---

## Global Layout `/app/(dashboard)/layout.tsx`

### Sidebar Navigation
Items in order:
1. 🏠 Dashboard
2. 🏦 China Bank
3. 📦 Products
4. 🏢 Companies
5. 🧾 Sell Bills
6. 💰 Received Voucher
7. 🏧 Our Banks
8. 📊 Reports
9. 💸 Expenses
10. 🇨🇳 JACK
11. 👥 Users (Owner/Admin only)

### Top Header
- Page title
- Current user name + role badge
- Logout button
- Dark/Light mode toggle

---

## Login Page `/app/(auth)/login/page.tsx`
- Centered card layout
- Company logo/name at top
- Email + Password fields
- Show/hide password toggle
- Login button with loading state
- Error message display
- No register link (users created by admin)

---

## Dashboard Home `/app/(dashboard)/page.tsx`

### Summary Cards Row 1:
- China Bank Balance (red if negative)
- Cash Balance (red if negative)  
- Total Outstanding (from all companies)
- Total Bank Balance (sum of all online accounts)

### Summary Cards Row 2:
- Today's Sales
- This Month P&L
- Total Products
- Pending Payments

### Charts:
- Monthly P&L Line Chart (last 6 months)
- Top 5 Companies by Sales (Bar chart)

---

## China Bank Page `/app/(dashboard)/china-bank/page.tsx`

### Header Card:
- Current Balance (large number)
- Red warning badge if negative
- "Add Credit" button

### Transaction History Table:
Columns: Date | Type (badge) | Reference | Amount | Balance After | Actions
- Type badges: Credit (green), Debit (red), Reversal (orange)
- Paginated
- Date range filter

### Add Credit Dialog/Sheet:
- Amount field
- Date picker
- Notes field
- Submit button

---

## Products Page `/app/(dashboard)/products/page.tsx`

### Controls Bar:
- Search input
- "Add Product" button
- View toggle (Card / Table)

### Card View:
Each card shows:
- Product image (placeholder if none)
- Product name
- Total buying entries count
- Total available CTN
- Quick stats: Total invested, Total sold

### Table View:
Columns: Product Name | Total CTN | Available CTN | Total Invested | Status

### Add/Edit Product Dialog:
- Product Name (required)
- Description (textarea)
- Image upload
- Save button

---

## Product Detail Page `/app/(dashboard)/products/[id]/page.tsx`

### Header:
- Product image + name + description
- Edit button
- Stats: Total CTN bought, Available CTN, Total Invested

### Tabs:

#### Tab 1: Buying History
Table columns: Date | CTN | QTY/Pcs | Rate | Final Cost | Status | Warehouse | Lock | Actions

**Buying Entry Row Expanded View:**
- All calculated fields displayed
- Lock button (enabled only when avgRmbRate + carryingRate filled)
- Lock icon: 🔒 locked (green) / 🔓 unlocked (gray)
- Warehouse status dropdown inline
- Edit / Delete buttons

**Add Buying Entry Sheet (slide-in from right):**
Fields in sections:
Section 1 - Basic:
- Entry Date
- Total CTN
- QTY per CTN
- Rate (RMB)
- CBM per CTN
- Weight per CTN

Section 2 - Payment:
- Given Amount
- (Auto shows: Total Amount, Remaining Amount, Status)

Section 3 - Costing (optional):
- Carrying Rate
- Avg RMB Rate
- (Auto shows: Total Carrying, Per Pcs Shipping, RMB-INR Purchase, Final Cost)

Section 4 - Warehouse:
- Warehouse Status dropdown

Auto-calculated fields shown in real-time as user types.

#### Tab 2: Selling History
Table columns: Bill No | Date | Company | CTN Sold | PCS | Rate | Amount | Profit | FIFO Note

---

## Companies Page `/app/(dashboard)/companies/page.tsx`

### Controls: Search + Add Company button

### Table/Card View:
Columns: Company Name | Owner | Mobile | City | Outstanding | Total Profit | Actions

### Add/Edit Company Sheet:
- Company Name (required)
- Owner Name
- Contact 1: Name + Mobile
- Contact 2: Name + Mobile
- GST Number
- Address
- City

---

## Company Detail Page `/app/(dashboard)/companies/[id]/page.tsx`

### Header:
- Company name, owner, mobile
- Stats cards: Total Billed | Total Received | Outstanding (highlighted if >0) | Total Profit

### Tabs:

#### Tab 1: Selling History
Table: Bill No | Date | Products | CTN | Amount | Profit
Click row → navigate to sell bill detail

#### Tab 2: Received Voucher
Table: Date | Amount | Mode (badge) | Bank Account | Remark | Actions
Running outstanding shown at bottom
Add Voucher button

---

## Sell Bills Page `/app/(dashboard)/sell-bills/page.tsx`

### Controls:
- Search by bill number / company
- Date range filter
- Add New Bill button

### Table:
Columns: Bill No | Date | Company | Products | Total Amount | WhatsApp | Actions

### Add/Edit Bill Page (full page, not dialog — complex form):
`/app/(dashboard)/sell-bills/new/page.tsx`
`/app/(dashboard)/sell-bills/[id]/edit/page.tsx`

Layout:
- Left: Bill form
  - Company dropdown (searchable)
  - Bill Date
  - Notes
- Right: Bill preview / summary

Product Line Items (dynamic, add multiple):
Each row: Product dropdown | CTN | PCS (auto) | Rate per PCS | Line Total | Remove button
Add Item button at bottom
Grand Total shown

### Sell Bill Detail Page `/app/(dashboard)/sell-bills/[id]/page.tsx`
- Full bill view (PDF-like layout in browser)
- FIFO breakdown per item (expandable)
- WhatsApp send button
- Edit / Delete / Download PDF buttons

---

## Received Voucher Page `/app/(dashboard)/received-voucher/page.tsx`

### Controls: 
- Filter by company, payment mode, date range
- Add Voucher button

### Table:
Columns: Date | Company | Amount | Mode (badge) | Bank Account | Remark | Actions

### Add/Edit Voucher Dialog:
- Company (searchable dropdown)
- Amount
- Payment Mode (Cash / Online toggle)
- Bank Account (shown only if Online)
- Date
- Remark

---

## Banks Page `/app/(dashboard)/banks/page.tsx`

### Section 1 — Cash Entity Card:
- Large card at top
- "CASH" label
- Current balance (red if negative)
- Click → Cash transaction history

### Section 2 — Bank Accounts:
- Grid of account cards
- Each card: Account name, balance, transaction count
- Add Account button
- Click card → Account detail / transaction history

### Transfer Dialog:
- From account (dropdown)
- To account (dropdown)
- Amount
- Date
- Notes

### Account Transaction History (Sheet or new page):
Table: Date | Type | Amount | Source | Balance After

---

## Reports Page `/app/(dashboard)/reports/page.tsx`

### Period Filter Bar (applies to all):
- Week / Month / Year / Custom range toggle
- Apply button

### P&L Section (Most prominent):
- Summary cards: Revenue | Cost | Gross Profit | Net Profit | Margin %
- Toggle: With Expenses / Without Expenses
- Line chart: P&L trend over selected period
- Table: Period breakdown

### Stock Section:
- Table: Product | Total CTN | Available CTN | In China | In Transit | In India | Locked entries

### Selling Section:
- Bar chart: Top products by revenue
- Bar chart: Top companies by revenue
- Table: Bill-wise breakdown

### Buying Section:
- Pie chart: Payment status breakdown
- Table: Buying entries by period

### Export Buttons on each section:
- Download PDF
- Download Excel

---

## Expenses Page `/app/(dashboard)/expenses/page.tsx`

### Controls:
- Date range filter
- Filter by account
- Add Expense button

### Table:
Columns: Date | Title | Amount | Paid From | Remark | Actions

### Summary at top:
- Total Expenses this month
- Total Expenses this year

### Add/Edit Expense Dialog:
- Title (free text)
- Amount
- Paid From (Cash or bank account dropdown)
- Date
- Remark

---

## JACK Page `/app/(dashboard)/jack/page.tsx`

### Cards Grid:
Each person card shows:
- Name
- Current Balance (RMB ¥)
- 🔴 warning if negative
- Pay In / Pay Out quick buttons
- Click → detail page

### Add China Person button (top right)

### JACK Detail Page `/app/(dashboard)/jack/[id]/page.tsx`

Header:
- Name (JACK badge if default)
- Current Balance in ¥ RMB (large)
- Pay In button (green)
- Pay Out button (red)

Transaction History Table:
Columns: Date | Type (badge) | Amount (¥) | Balance After (¥) | Notes | Actions

### Pay In / Pay Out Dialog:
- Amount (RMB ¥)
- Date
- Notes
- Confirm button

---

## Users Page `/app/(dashboard)/users/page.tsx`
(Owner/Admin only — hide from sidebar for others)

### Table:
Columns: Name | Email | Role (badge) | Status | Failed Attempts | Blocked | Actions

### Actions per user:
- Edit
- Reset Password (Owner only)
- Unblock (Owner only, shown if isBlocked)
- Delete (cannot delete Owner role)

### Add/Edit User Dialog:
- Full Name
- Email
- Password (on add) / not shown on edit
- Role dropdown
- Status toggle

### Reset Password Dialog (Owner only):
- New Password
- Confirm Password

---

## Shared Components

### `/components/layout/Sidebar.tsx`
### `/components/layout/Header.tsx`
### `/components/ui/StatCard.tsx` — reusable metric card with icon, value, label, trend
### `/components/ui/DataTable.tsx` — reusable TanStack table wrapper
### `/components/ui/ConfirmDialog.tsx` — delete confirmation
### `/components/ui/DateRangePicker.tsx`
### `/components/ui/SearchableSelect.tsx` — dropdown with search
### `/components/ui/StatusBadge.tsx` — colored badges for statuses
### `/components/ui/AmountDisplay.tsx` — formats ₹ or ¥ with color for negative
### `/components/ui/LoadingSpinner.tsx`
### `/components/ui/PageHeader.tsx` — title + breadcrumb + action button

### PDF Template `/components/pdf/BillTemplate.tsx`
Using @react-pdf/renderer:
- Company header (hardcoded name/address/phone)
- Bill number and date
- Customer details
- Line items table
- Grand total
- Footer with thank you note
