# Business Logic & Special Flows

## Instructions for Cursor
This file contains the critical business logic that must be implemented exactly as described.
These are the most complex parts of the system. Read carefully before implementing.

---

## 1. FIFO Selling Algorithm

### When a Sell Bill is created with product line items:

```
FUNCTION processFIFO(productId, ctnToSell, ratePerPcs):

1. Fetch all BuyingEntries where:
   - product = productId
   - warehouseStatus = 'india_warehouse'
   - availableCtn > 0
   - ORDER BY createdAt ASC (oldest first)

2. Initialize:
   - remainingCtnToSell = ctnToSell
   - fifoBreakdown = []
   - fifoNotes = []

3. For each buyingEntry in sorted list:
   - If remainingCtnToSell <= 0: BREAK
   
   - ctnFromThisEntry = MIN(remainingCtnToSell, buyingEntry.availableCtn)
   - pcsFromThisEntry = ctnFromThisEntry * buyingEntry.qty
   - profitFromThisEntry = (ratePerPcs - buyingEntry.finalCost) * pcsFromThisEntry
   
   - fifoBreakdown.push({
       buyingEntry: buyingEntry._id,
       ctnConsumed: ctnFromThisEntry,
       pcsConsumed: pcsFromThisEntry,
       finalCost: buyingEntry.finalCost,
       profit: profitFromThisEntry
     })
   
   - buyingEntry.availableCtn -= ctnFromThisEntry
   - Save buyingEntry
   
   - remainingCtnToSell -= ctnFromThisEntry
   - fifoNotes.push(`${ctnFromThisEntry} CTN from batch dated ${buyingEntry.entryDate}`)

4. If remainingCtnToSell > 0: 
   THROW ERROR "Insufficient stock. Only X CTN available in India Warehouse"

5. Generate fifoNote if fifoBreakdown.length > 1:
   fifoNote = "Stock taken from: " + fifoNotes.join(" + ")

6. Return { fifoBreakdown, fifoNote, totalProfit: sum of all profits }
```

### When a Sell Bill is DELETED:
```
For each SellBillItem:
  For each item in fifoBreakdown:
    buyingEntry.availableCtn += fifoBreakdown.ctnConsumed
    Save buyingEntry
Delete SellBillItem
Delete SellBill
```

### When a Sell Bill is EDITED:
```
1. REVERSE old FIFO (same as delete flow above, but don't delete records yet)
2. Process new FIFO with updated values
3. Update SellBill and SellBillItems
```

---

## 2. China Bank Lock/Unlock Flow

### On LOCK (POST `/api/buying-entries/[id]/lock`):
```
1. Validate: buyingEntry.avgRmbRate exists AND buyingEntry.carryingRate exists
   If not → return error "Please fill Avg RMB Rate and Carrying Rate before locking"

2. If buyingEntry.isLocked = true already:
   - Create REVERSAL transaction first (see unlock flow)

3. Get current China Bank balance (sum of all transactions balanceAfter, take last one)

4. Debit amount = buyingEntry.totalAmount 
   (Note: totalAmount is in RMB terms, but we store in INR — confirm with business logic)
   Actually: debit amount = buyingEntry.finalCost * buyingEntry.totalQty
   (finalCost per piece × total pieces = total INR cost)

5. Create ChinaBankTransaction:
   {
     type: 'debit',
     amount: debitAmount,
     balanceAfter: currentBalance - debitAmount,
     buyingEntry: buyingEntry._id,
     reference: `Debit for ${product.productName} - Entry ${buyingEntry._id}`,
     transactionDate: now
   }

6. Update buyingEntry: isLocked = true, lockedAt = now

7. Return updated entry + new balance
```

### On UNLOCK (POST `/api/buying-entries/[id]/unlock`):
```
1. Find the original debit ChinaBankTransaction for this buyingEntry

2. Get current China Bank balance

3. Create REVERSAL ChinaBankTransaction:
   {
     type: 'reversal',
     amount: originalDebitTransaction.amount,
     balanceAfter: currentBalance + originalDebitTransaction.amount,
     buyingEntry: buyingEntry._id,
     reference: `Reversal for ${product.productName} - Entry ${buyingEntry._id}`,
     transactionDate: now
   }

4. Update buyingEntry: isLocked = false, lockedAt = undefined

5. Return updated entry + new balance
```

---

## 3. Running Balance Calculation

### For any transaction-based ledger (ChinaBank, BankAccount, ChinaPerson):
```
NEVER store a separate "current balance" field that can go out of sync.
INSTEAD: Calculate balanceAfter at time of creating each transaction.

On creating a new transaction:
1. Get the LAST transaction for this entity (sorted by createdAt DESC)
2. lastBalance = lastTransaction?.balanceAfter ?? 0
3. If type = credit/pay_in: newBalance = lastBalance + amount
4. If type = debit/pay_out/expense: newBalance = lastBalance - amount
5. If type = reversal: newBalance = lastBalance + amount (reversing a debit)
6. Store balanceAfter = newBalance in the transaction

For BankAccount.currentBalance:
- Keep this field updated on every transaction for quick dashboard reads
- Recalculate from transactions if ever out of sync

WARNING: When deleting a transaction in the middle, 
you must recalculate balanceAfter for ALL subsequent transactions.
This is critical for data integrity.
```

---

## 4. Auto Bill Number Generation

```
On creating a new SellBill:
1. Find the maximum billNumber in the SellBill collection
2. If no bills exist: startNumber = 1001
3. Else: nextNumber = maxBillNumber + 1
4. Use MongoDB findOneAndUpdate with $inc for atomic operation to prevent race conditions
```

---

## 5. Payment Status Auto-Update (BuyingEntry)

```
After any change to givenAmount or totalAmount:
- If totalAmount === 0: status = 'unpaid'
- If givenAmount === 0: status = 'unpaid'  
- If Math.abs(remainingAmount) < 0.01: status = 'paid'
- Else: status = 'partiallypaid'
```

---

## 6. Outstanding Balance Calculation (Company)

```
GET /api/companies/[id]/outstanding:

totalBilled = sum of all SellBill.totalAmount where company = companyId
totalReceived = sum of all PaymentReceipt.amount where company = companyId
outstanding = totalBilled - totalReceived

Return: { totalBilled, totalReceived, outstanding, isOverdue: outstanding > 0 }
```

---

## 7. P&L Calculation Logic

```
GET /api/reports/pnl?period=month&withExpenses=true:

revenue = sum of SellBillItem.totalAmount for period
cost = sum of (SellBillItem.fifoBreakdown[].finalCost * fifoBreakdown[].pcsConsumed) for period
grossProfit = revenue - cost
grossMargin = (grossProfit / revenue) * 100

If withExpenses:
  totalExpenses = sum of Expense.amount for period
  netProfit = grossProfit - totalExpenses
  netMargin = (netProfit / revenue) * 100

Return both with and without expense figures always.
Frontend decides which to show based on toggle.
```

---

## 8. Delete Restrictions Summary

| Entity | Block Delete If |
|--------|----------------|
| Product | Has BuyingEntries |
| BuyingEntry | Has SellBillItems linked (availableCtn < totalCtn) |
| Company | Has SellBills or PaymentReceipts |
| SellBill | None (but must reverse FIFO) |
| BankAccount | isDefault=true OR has transactions |
| ChinaPerson | isDefault=true |
| User | role='owner' |

---

## 9. WhatsApp Business API Integration

```
File: /lib/whatsapp.ts

FUNCTION sendBillOnWhatsApp(billId, mobileNumber):

1. Fetch full bill data with company and items

2. Generate PDF using @react-pdf/renderer
   - Render <BillTemplate bill={billData} /> to buffer
   - Save temporarily or convert to base64

3. Upload PDF to WhatsApp Media API:
   POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/media
   Headers: Authorization: Bearer {WHATSAPP_API_TOKEN}
   Body: FormData with PDF file

4. Send message with document:
   POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
   Body: {
     messaging_product: "whatsapp",
     to: mobileNumber, // include country code: 91XXXXXXXXXX
     type: "document",
     document: {
       id: mediaId, // from step 3
       filename: `Bill-${billNumber}.pdf`,
       caption: `Dear ${companyName}, please find your bill #${billNumber} attached. Total: ₹${totalAmount}`
     }
   }

5. Update SellBill: whatsappSent=true, whatsappSentAt=now

ERROR HANDLING:
- If mobile number not found → return error with option to add number
- Format mobile: remove spaces, add 91 prefix if not present
- Log all WhatsApp API errors
```

---

## 10. JWT Middleware

```typescript
// /middleware.ts
// Protect all routes except /login and /api/auth/login

// /lib/auth.ts
FUNCTION verifyToken(token):
  - Decode JWT using JWT_SECRET
  - Check expiry
  - Return { userId, role, email }

FUNCTION requireRole(...roles):
  - Middleware factory
  - Check if user role is in allowed roles
  - Return 403 if not authorized

Role permissions:
- Owner: all routes
- Admin: all routes except user management sensitive actions
- Manager: no user management, no delete on financial entries
- Viewer: GET requests only across all modules
```

---

## 11. Real-time Auto Calculation (Frontend)

```
In buying entry form, use React Hook Form watch() to:
- Watch: totalCtn, qty → calculate totalQty display
- Watch: cbm, totalCtn → calculate totalCbm display  
- Watch: weight, totalCtn → calculate totalWeight display
- Watch: totalQty, rate → calculate totalAmount display
- Watch: totalAmount, givenAmount → calculate remainingAmount display
- Watch: totalCbm, carryingRate → calculate totalCarrying display
- Watch: totalCarrying, totalQty → calculate perPisShipping display
- Watch: rate, avgRmbRate → calculate rmbInrPurchase display
- Watch: rmbInrPurchase, perPisShipping → calculate finalCost display

Show all auto-calculated fields in a summary panel on the right side of the form.
Use debounce of 300ms on calculations to avoid excessive re-renders.
Lock button enabled state: watch avgRmbRate AND carryingRate → both must have values > 0
```
