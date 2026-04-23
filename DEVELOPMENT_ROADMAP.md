# Project Setup & Development Roadmap

## Instructions for Cursor
Follow this roadmap in order. Complete each phase fully before moving to the next.
This ensures dependencies are built before they are needed.

---

## Initial Project Setup

### Step 1: Create Next.js Project
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=no --import-alias="@/*"
```

### Step 2: Install All Dependencies
```bash
# UI Components
npx shadcn@latest init
npx shadcn@latest add button card dialog drawer form input label select separator sheet sidebar skeleton table tabs textarea toast toggle badge alert

# Core Libraries
npm install mongoose
npm install jsonwebtoken bcryptjs
npm install @types/jsonwebtoken @types/bcryptjs

# Forms & Validation
npm install react-hook-form zod @hookform/resolvers

# Tables
npm install @tanstack/react-table

# State Management
npm install zustand

# Charts
npm install recharts

# PDF Generation
npm install @react-pdf/renderer
npm install @types/react-pdf

# Date handling
npm install date-fns
npm install react-day-picker

# HTTP Client
npm install axios

# Excel Export
npm install xlsx

# Utilities
npm install lucide-react
npm install next-themes
npm install clsx tailwind-merge
npm install sonner
```

### Step 3: Create Environment File
Create `.env.local` with all variables from MAIN_RULES.md

### Step 4: Setup MongoDB Connection
Create `/lib/mongodb.ts`:
- Singleton pattern for mongoose connection
- Use MONGODB_URI from env
- Handle connection caching for Next.js hot reload

### Step 5: Create All Models
Follow DATABASE_SCHEMA.md exactly
Create all 13 model files in `/models/`

### Step 6: Initial data
Ensure Owner user, Cash BankAccount, and default ChinaPerson exist (create via app or DB).

### Step 7: Setup Middleware
Create `/middleware.ts` for JWT verification on protected routes

---

## Development Order (Phase by Phase)

### Phase 1: Authentication
Build first — everything depends on this.

Files to create:
- `/models/User.ts`
- `/app/(auth)/login/page.tsx`
- `/app/api/auth/login/route.ts`
- `/app/api/auth/me/route.ts`
- `/middleware.ts`
- `/lib/auth.ts`
- `/store/authStore.ts` (Zustand store for user state)
- `/components/layout/AuthGuard.tsx`

Test: Can login, JWT stored, protected routes work

---

### Phase 2: Layout & Navigation
Build shell before any features.

Files to create:
- `/app/(dashboard)/layout.tsx`
- `/components/layout/Sidebar.tsx`
- `/components/layout/Header.tsx`
- `/app/(dashboard)/page.tsx` (placeholder dashboard)
- All shared UI components from UI_PAGES.md

Test: Sidebar navigates, layout renders correctly

---

### Phase 3: China Bank Module
Simple but foundational — other modules depend on its balance.

Files to create:
- `/models/ChinaBankTransaction.ts`
- `/app/api/china-bank/route.ts`
- `/app/api/china-bank/transactions/route.ts`
- `/app/api/china-bank/transactions/[id]/route.ts`
- `/app/(dashboard)/china-bank/page.tsx`
- `/components/china-bank/ChinaBankCard.tsx`
- `/components/china-bank/TransactionHistory.tsx`
- `/components/china-bank/AddCreditDialog.tsx`

Test: Can add credit, see balance, see history

---

### Phase 4: Product Module
Core of the system — most complex.

Files to create:
- `/models/Product.ts`
- `/models/BuyingEntry.ts`
- `/app/api/products/route.ts`
- `/app/api/products/[id]/route.ts`
- `/app/api/buying-entries/route.ts`
- `/app/api/buying-entries/[id]/route.ts`
- `/app/api/buying-entries/[id]/lock/route.ts`
- `/app/api/buying-entries/[id]/unlock/route.ts`
- `/app/(dashboard)/products/page.tsx`
- `/app/(dashboard)/products/[id]/page.tsx`
- `/components/products/ProductCard.tsx`
- `/components/products/ProductTable.tsx`
- `/components/products/BuyingEntryForm.tsx`
- `/components/products/BuyingEntryTable.tsx`
- `/components/products/LockButton.tsx`
- `/components/products/WarehouseStatusSelect.tsx`
- `/components/products/AutoCalculatedFields.tsx`

Test: 
- Create product
- Add buying entries
- Auto calculations work
- Lock triggers China Bank debit
- Unlock triggers reversal
- Warehouse status changes work
- Delete blocked if sales exist

---

### Phase 5: Company Module

Files to create:
- `/models/Company.ts`
- `/app/api/companies/route.ts`
- `/app/api/companies/[id]/route.ts`
- `/app/(dashboard)/companies/page.tsx`
- `/app/(dashboard)/companies/[id]/page.tsx`
- `/components/companies/CompanyForm.tsx`
- `/components/companies/CompanyCard.tsx`
- `/components/companies/OutstandingBadge.tsx`

Test: CRUD works, detail page shows tabs

---

### Phase 6: Sell Bill Module
Depends on: Products, Companies, BuyingEntries (FIFO)

Files to create:
- `/models/SellBill.ts`
- `/models/SellBillItem.ts`
- `/app/api/sell-bills/route.ts`
- `/app/api/sell-bills/[id]/route.ts`
- `/app/api/sell-bills/[id]/whatsapp/route.ts`
- `/app/(dashboard)/sell-bills/page.tsx`
- `/app/(dashboard)/sell-bills/new/page.tsx`
- `/app/(dashboard)/sell-bills/[id]/page.tsx`
- `/app/(dashboard)/sell-bills/[id]/edit/page.tsx`
- `/components/sell-bills/BillForm.tsx`
- `/components/sell-bills/BillLineItem.tsx`
- `/components/sell-bills/FIFOBreakdown.tsx`
- `/components/sell-bills/BillDetail.tsx`
- `/components/pdf/BillTemplate.tsx`
- `/lib/whatsapp.ts`
- `/lib/fifo.ts` (FIFO algorithm as utility)

Test:
- Create bill with multiple products
- FIFO correctly consumes oldest entries
- FIFO note generated for multi-batch
- Edit reverses and recalculates FIFO
- Delete restores inventory
- PDF generates correctly
- WhatsApp sends (mock in dev)

---

### Phase 7: Banks Module
Depends on: Nothing (standalone)

Files to create:
- `/models/BankAccount.ts`
- `/models/BankTransaction.ts`
- `/app/api/banks/route.ts`
- `/app/api/banks/[id]/route.ts`
- `/app/api/banks/[id]/transactions/route.ts`
- `/app/api/banks/transfer/route.ts`
- `/app/(dashboard)/banks/page.tsx`
- `/app/(dashboard)/banks/[id]/page.tsx`
- `/components/banks/CashCard.tsx`
- `/components/banks/BankAccountCard.tsx`
- `/components/banks/TransferDialog.tsx`
- `/components/banks/TransactionHistory.tsx`

Test: Cash entity exists, can add banks, transfer works, history shows sources

---

### Phase 8: Received Voucher Module
Depends on: Companies, Banks

Files to create:
- `/models/PaymentReceipt.ts`
- `/app/api/received-voucher/route.ts`
- `/app/api/received-voucher/[id]/route.ts`
- `/app/(dashboard)/received-voucher/page.tsx`
- `/components/received-voucher/PaymentFormDialog.tsx`

Test:
- Add payment → credits correct bank/cash account
- Company outstanding updates
- Delete → reverses bank transaction

---

### Phase 9: Expenses Module
Depends on: Banks

Files to create:
- `/models/Expense.ts`
- `/app/api/expenses/route.ts`
- `/app/api/expenses/[id]/route.ts`
- `/app/(dashboard)/expenses/page.tsx`
- `/components/expenses/ExpenseForm.tsx`
- `/components/expenses/ExpenseTable.tsx`

Test: Add expense → debits correct account, edit/delete reverses

---

### Phase 10: JACK Module
Depends on: Nothing (standalone)

Files to create:
- `/models/ChinaPerson.ts`
- `/models/ChinaPersonTransaction.ts`
- `/app/api/jack/route.ts`
- `/app/api/jack/[id]/route.ts`
- `/app/api/jack/[id]/transactions/route.ts`
- `/app/api/jack/[id]/pay-in/route.ts`
- `/app/api/jack/[id]/pay-out/route.ts`
- `/app/(dashboard)/jack/page.tsx`
- `/app/(dashboard)/jack/[id]/page.tsx`
- `/components/jack/ChinaPersonCard.tsx`
- `/components/jack/PayInOutDialog.tsx`
- `/components/jack/TransactionHistory.tsx`

Test: JACK exists by default, can add more, pay in/out works in RMB

---

### Phase 11: Reports Module
Depends on: All modules (aggregates everything)

Files to create:
- `/app/api/reports/pnl/route.ts`
- `/app/api/reports/stock/route.ts`
- `/app/api/reports/selling/route.ts`
- `/app/api/reports/buying/route.ts`
- `/app/api/reports/export/[type]/route.ts`
- `/app/(dashboard)/reports/page.tsx`
- `/components/reports/PLReport.tsx`
- `/components/reports/StockReport.tsx`
- `/components/reports/SellingReport.tsx`
- `/components/reports/BuyingReport.tsx`
- `/components/reports/PeriodFilter.tsx`
- `/components/reports/ExportButton.tsx`
- `/lib/excel-export.ts`

Test: All reports show correct data, charts render, exports work

---

### Phase 12: User Management
Depends on: Auth (Phase 1)

Files to create:
- `/app/api/users/route.ts`
- `/app/api/users/[id]/route.ts`
- `/app/api/users/[id]/reset-password/route.ts`
- `/app/api/users/[id]/unblock/route.ts`
- `/app/(dashboard)/users/page.tsx`
- `/components/users/UserForm.tsx`
- `/components/users/UserTable.tsx`
- `/components/users/ResetPasswordDialog.tsx`

Test: CRUD works, role restrictions enforced, password reset works

---

### Phase 13: Dashboard Home
Build last — aggregates data from all modules.

Update `/app/(dashboard)/page.tsx` with:
- All summary cards
- Charts with real data
- Quick action buttons

---

### Phase 14: Final Polish
- Mobile responsiveness check all pages
- Loading states on all async operations
- Error boundaries
- Toast notifications consistent
- Dark mode testing
- Performance: Add proper indexes to MongoDB
- Security: Rate limiting on auth routes
- Review all delete restrictions working

---

## Key Files Reference

### `/lib/mongodb.ts` — DB Connection
### `/lib/auth.ts` — JWT utilities  
### `/lib/fifo.ts` — FIFO algorithm
### `/lib/whatsapp.ts` — WhatsApp API
### `/lib/excel-export.ts` — Excel generation
### `/lib/utils.ts` — shared utilities (formatCurrency, formatDate, etc.)
### `/lib/constants.ts` — app constants
### `/middleware.ts` — route protection
### `/store/authStore.ts` — Zustand auth state
### `/types/index.ts` — shared TypeScript types
