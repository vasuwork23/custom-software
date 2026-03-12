# API Routes — Complete Plan

## Instructions for Cursor
- All routes under `/app/api/`
- Every route must verify JWT (except login)
- Every route returns `{ success: true/false, data, message }`
- Use Next.js Route Handlers (not pages/api)
- Always recalculate auto fields on backend, never trust frontend values

---

## Auth Routes `/api/auth/`

### POST `/api/auth/login`
- Body: `{ email, password }`
- Verify email exists, password matches (bcrypt.compare)
- Check if account isBlocked → return error if blocked
- On wrong password: increment failedLoginAttempts, if >= 10 set isBlocked=true
- On success: reset failedLoginAttempts to 0, generate JWT, return token + user info
- Response: `{ token, user: { id, fullName, email, role } }`

### POST `/api/auth/logout`
- Clear session (JWT handled on frontend)

### GET `/api/auth/me`
- Return current user from JWT

---

## China Bank Routes `/api/china-bank/`

### GET `/api/china-bank/balance`
- Calculate current balance from all transactions
- Return: `{ balance, isNegative }`

### GET `/api/china-bank/transactions`
- Query params: `page, limit, startDate, endDate`
- Return paginated transaction history with running balance

### POST `/api/china-bank/credit`
- Body: `{ amount, notes, transactionDate }`
- Create ChinaBankTransaction with type='credit'
- Recalculate and store balanceAfter

### DELETE `/api/china-bank/transactions/[id]`
- Only allow delete of manual credit entries
- Cannot delete auto debit/reversal entries

---

## Product Routes `/api/products/`

### GET `/api/products`
- Query params: `page, limit, search`
- Return master products list with summary stats per product

### POST `/api/products`
- Body: `{ productName, productDescription, productImage }`
- Create master product

### GET `/api/products/[id]`
- Return product with buying history and selling history summary

### PUT `/api/products/[id]`
- Update master product fields only

### DELETE `/api/products/[id]`
- Only allow if no buying entries exist for this product

---

## Buying Entry Routes `/api/buying-entries/`

### GET `/api/buying-entries`
- Query params: `productId, page, limit, status, warehouseStatus`
- Return buying entries for a product

### POST `/api/buying-entries`
- Body: all manual fields from BuyingEntry schema
- Auto-calculate all computed fields on backend
- Set availableCtn = totalCtn on creation
- Set isLocked = false, warehouseStatus = 'china_warehouse'

### PUT `/api/buying-entries/[id]`
- Recalculate all auto fields
- If was locked → unlock first (trigger reversal), save, re-lock if needed

### DELETE `/api/buying-entries/[id]`
- Check if any SellBillItem references this entry → block with error
- If isLocked → reverse debit from ChinaBank first
- Then delete

### POST `/api/buying-entries/[id]/lock`
- Validate avgRmbRate and carryingRate exist
- If already locked → create reversal transaction first
- Create new ChinaBankTransaction debit with finalCost * totalCtn... 
  IMPORTANT: Debit amount = totalAmount (the INR value of this buying batch)
- Set isLocked = true, lockedAt = now

### POST `/api/buying-entries/[id]/unlock`
- Create ChinaBankTransaction reversal
- Set isLocked = false, lockedAt = undefined

---

## Sell Bill Routes `/api/sell-bills/`

### GET `/api/sell-bills`
- Query params: `page, limit, companyId, startDate, endDate`
- Return bills with company name and total

### POST `/api/sell-bills`
- Body: `{ companyId, billDate, items: [{ productId, ctnSold, ratePerPcs }], notes }`
- Auto-generate billNumber (find max + 1, starting from 1001)
- For each item: run FIFO algorithm
- FIFO Algorithm:
  1. Get all BuyingEntries for product where warehouseStatus='india_warehouse' AND availableCtn > 0, sorted by createdAt ASC
  2. Consume CTN from oldest entry first
  3. If one entry not enough, move to next
  4. Build fifoBreakdown array
  5. Auto-generate fifoNote if spanning multiple entries
  6. Deduct availableCtn from each affected BuyingEntry
  7. Calculate profit per breakdown item
- Create SellBill + SellBillItems

### GET `/api/sell-bills/[id]`
- Return full bill with items, fifoBreakdown, company details

### PUT `/api/sell-bills/[id]`
- Reverse old FIFO (restore availableCtn to all previously consumed entries)
- Recalculate new FIFO with updated values
- Update all linked records

### DELETE `/api/sell-bills/[id]`
- Reverse FIFO: restore availableCtn to all consumed BuyingEntries
- Delete SellBillItems then SellBill

### POST `/api/sell-bills/[id]/whatsapp`
- Generate PDF of bill
- Send via WhatsApp Business API to company's mobile number
- Update whatsappSent=true, whatsappSentAt=now

---

## Company Routes `/api/companies/`

### GET `/api/companies`
- Query params: `page, limit, search`
- Return companies list with outstanding balance per company

### POST `/api/companies`
- Body: all company fields

### GET `/api/companies/[id]`
- Return company with:
  - Header stats: totalProfit, totalOutstanding
  - Selling history (from SellBills) — paginated
  - Payment received history — paginated

### PUT `/api/companies/[id]`
### DELETE `/api/companies/[id]`
- Block if any SellBills or PaymentReceipts linked

### GET `/api/companies/[id]/outstanding`
- Calculate: sum(SellBill.totalAmount) - sum(PaymentReceipt.amount)

---

## Received Voucher (Payment Receipt) Routes `/api/received-voucher/`

### GET `/api/received-voucher`
- Query params: `page, limit, companyId, paymentMode, startDate, endDate`

### POST `/api/received-voucher`
- Body: `{ companyId, amount, paymentMode, bankAccountId?, paymentDate, remark }`
- Create PaymentReceipt
- Create BankTransaction credit on selected account (cash or online)

### PUT `/api/received-voucher/[id]`
- Reverse old BankTransaction
- Create new BankTransaction with updated values

### DELETE `/api/received-voucher/[id]`
- Reverse BankTransaction credit
- Delete PaymentReceipt

---

## Bank Account Routes `/api/banks/`

### GET `/api/banks`
- Return all bank accounts + cash entity with current balances

### POST `/api/banks`
- Create online bank account (type='online')
- Cannot create type='cash' via API (create via initial setup)

### PUT `/api/banks/[id]`
- Update account name only

### DELETE `/api/banks/[id]`
- Block if isDefault=true
- Block if any transactions linked

### GET `/api/banks/[id]/transactions`
- Return paginated transaction history with running balance and source

### POST `/api/banks/transfer`
- Body: `{ fromAccountId, toAccountId, amount, date, notes }`
- Create debit on fromAccount
- Create credit on toAccount
- Both transactions reference each other as sourceRef

---

## Expense Routes `/api/expenses/`

### GET `/api/expenses`
- Query params: `page, limit, startDate, endDate, paidFrom`

### POST `/api/expenses`
- Body: `{ title, amount, paidFrom, expenseDate, remark }`
- Create Expense
- Create BankTransaction debit on paidFrom account

### PUT `/api/expenses/[id]`
- Reverse old debit
- Create new debit with updated values

### DELETE `/api/expenses/[id]`
- Reverse debit
- Delete Expense

---

## JACK / China Person Routes `/api/jack/`

### GET `/api/jack`
- Return all china persons with current balance

### POST `/api/jack`
- Create new china person (default person is created via initial setup)

### PUT `/api/jack/[id]`
- Update name only, cannot update isDefault persons name? (confirm with user)

### DELETE `/api/jack/[id]`
- Block if isDefault=true

### GET `/api/jack/[id]/transactions`
- Return paginated transactions with running balance

### POST `/api/jack/[id]/pay-in`
- Body: `{ amount, transactionDate, notes }`
- Create ChinaPersonTransaction type='pay_in'
- Update ChinaPerson.currentBalance

### POST `/api/jack/[id]/pay-out`
- Body: `{ amount, transactionDate, notes }`
- Create ChinaPersonTransaction type='pay_out'
- Update ChinaPerson.currentBalance

### DELETE `/api/jack/transactions/[id]`
- Reverse balance impact
- Delete transaction

---

## Report Routes `/api/reports/`

### GET `/api/reports/pnl`
- Query params: `period (week/month/year), startDate, endDate, withExpenses (boolean)`
- Aggregate: Revenue, Cost, Gross Profit, Net Profit (with expenses)
- Group by period
- Return chart data + summary

### GET `/api/reports/stock`
- Return all products with current stock per buying entry
- Include warehouseStatus breakdown

### GET `/api/reports/selling`
- Query params: `period, companyId, productId`
- Aggregate sell bills by period
- Top selling products, company breakdown

### GET `/api/reports/buying`
- Query params: `period`
- Aggregate buying entries by period
- Payment status breakdown

### GET `/api/reports/export/[type]`
- Query params: `format (pdf/excel), reportType, ...filters`
- Generate and return file download

---

## User Management Routes `/api/users/` (Owner only)

### GET `/api/users`
### POST `/api/users`
### PUT `/api/users/[id]`
### DELETE `/api/users/[id]`
- Block if role='owner'

### POST `/api/users/[id]/reset-password`
- Owner only
- Body: `{ newPassword }`
- Hash and update password

### POST `/api/users/[id]/unblock`
- Owner only
- Set isBlocked=false, failedLoginAttempts=0
