# Database Schema — All MongoDB Models

## Instructions for Cursor
Create all these models inside `/models/` directory.
Each model file should export both the Interface and the Model.
Always delete cached mongoose model before registering: `if (mongoose.models.ModelName) delete mongoose.models.ModelName`

---

## 1. User Model (`/models/User.ts`)
```typescript
interface IUser {
  fullName: string
  email: string // unique, lowercase
  password: string // bcrypt hashed
  role: 'owner' | 'admin' | 'manager' | 'viewer'
  status: 'active' | 'inactive'
  failedLoginAttempts: number // default 0
  isBlocked: boolean // default false, true after 10 failed attempts
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - Owner role cannot be deleted
// - Password must be bcrypt hashed before save (pre-save hook)
// - Email must be unique index
```

---

## 2. Product Model (`/models/Product.ts`) — Master Product
```typescript
interface IProduct {
  productName: string // required, unique index
  productDescription?: string
  productImage?: string // URL or base64
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - This is the MASTER product, just name/image/description
// - All buying history is in BuyingEntry model
```

---

## 3. BuyingEntry Model (`/models/BuyingEntry.ts`)
```typescript
interface IBuyingEntry {
  product: ObjectId // ref: Product, required
  
  // Manual fields
  totalCtn: number // total cartons
  qty: number // pieces per carton
  rate: number // rate in RMB per piece
  cbm: number // CBM per carton
  weight: number // weight per carton
  givenAmount: number // amount paid so far
  carryingRate?: number // manual, integer
  avgRmbRate?: number // manual, float 2 decimal
  
  // Auto-calculated fields (calculated in pre-save hook)
  totalQty: number // totalCtn * qty
  totalCbm: number // cbm * totalCtn (2 decimal)
  totalWeight: number // totalCtn * weight (2 decimal)
  totalAmount: number // totalQty * rate (integer)
  remainingAmount: number // totalAmount - givenAmount
  totalCarrying: number // totalCbm * carryingRate
  perPisShipping: number // totalCarrying / totalQty (2 decimal)
  rmbInrPurchase: number // rate * avgRmbRate (2 decimal)
  finalCost: number // rmbInrPurchase + perPisShipping (2 decimal)
  
  // Status fields
  currentStatus: 'paid' | 'unpaid' | 'partiallypaid' // auto from givenAmount vs totalAmount
  warehouseStatus: 'china_warehouse' | 'in_transit' | 'india_warehouse'
  
  // Lock/Debit mechanism
  isLocked: boolean // default false
  lockedAt?: Date
  
  // Inventory tracking
  availableCtn: number // starts at totalCtn, reduces on sell (FIFO)
  
  // Date
  entryDate: Date
  
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - isLocked=true triggers ChinaBankTransaction debit
// - isLocked=false (unlock) triggers ChinaBankTransaction reversal
// - Cannot delete if any SellBillItem references this entry
// - availableCtn decreases as sales happen (FIFO)
// - Selling only allowed when warehouseStatus = 'india_warehouse'
```

---

## 4. ChinaBankTransaction Model (`/models/ChinaBankTransaction.ts`)
```typescript
interface IChinaBankTransaction {
  type: 'credit' | 'debit' | 'reversal'
  amount: number // in INR ₹
  balanceAfter: number // running balance after this transaction
  reference?: string // note for credit, or BuyingEntry ID for debit
  buyingEntry?: ObjectId // ref: BuyingEntry (for debit/reversal)
  notes?: string
  transactionDate: Date
  createdBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - Credit: manual entry
// - Debit: triggered when BuyingEntry isLocked = true
// - Reversal: triggered when BuyingEntry isLocked = false (unlock)
// - Balance can go negative — show warning on dashboard card
```

---

## 5. Company Model (`/models/Company.ts`) — Seller Companies
```typescript
interface ICompany {
  companyName: string // required
  ownerName?: string
  contact1Name?: string
  contact1Mobile?: string
  contact2Name?: string
  contact2Mobile?: string
  gstNumber?: string
  address?: string
  city?: string
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
```

---

## 6. SellBill Model (`/models/SellBill.ts`)
```typescript
interface ISellBill {
  billNumber: number // auto-increment starting from 1001
  company: ObjectId // ref: Company, required
  billDate: Date
  items: ObjectId[] // ref: SellBillItem
  totalAmount: number // sum of all item totals
  notes?: string
  whatsappSent: boolean // default false
  whatsappSentAt?: Date
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - billNumber auto-increments from 1001
// - On delete: reverse all FIFO, restore availableCtn
// - On edit: reverse old FIFO, recalculate new FIFO
```

---

## 7. SellBillItem Model (`/models/SellBillItem.ts`)
```typescript
interface ISellBillItem {
  sellBill: ObjectId // ref: SellBill
  product: ObjectId // ref: Product
  ctnSold: number // cartons sold
  pcsSold: number // auto: ctnSold * qty (from buying entry)
  ratePerPcs: number // selling rate per piece
  totalAmount: number // pcsSold * ratePerPcs
  
  // FIFO breakdown — which buying entries were consumed
  fifoBreakdown: [
    {
      buyingEntry: ObjectId // ref: BuyingEntry
      ctnConsumed: number
      pcsConsumed: number
      finalCost: number // finalCost from that buying entry at time of sale
      profit: number // (ratePerPcs - finalCost) * pcsConsumed
    }
  ]
  
  fifoNote?: string // auto-generated note if spanning multiple buying entries
  totalProfit: number // sum of profit from fifoBreakdown
  
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
```

---

## 8. PaymentReceipt Model (`/models/PaymentReceipt.ts`)
```typescript
interface IPaymentReceipt {
  company: ObjectId // ref: Company, required
  amount: number // INR ₹
  paymentMode: 'cash' | 'online'
  bankAccount?: ObjectId // ref: BankAccount, required if paymentMode = 'online'
  paymentDate: Date
  remark?: string
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - If paymentMode = 'cash' → credit Cash entity (BankAccount with type='cash')
// - If paymentMode = 'online' → credit selected BankAccount
// - On delete → reverse the credit from that account
```

---

## 9. BankAccount Model (`/models/BankAccount.ts`)
```typescript
interface IBankAccount {
  accountName: string // required
  type: 'cash' | 'online' // cash is single fixed entity
  isDefault: boolean // true for Cash entity — cannot be deleted
  currentBalance: number // running balance
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - Cash entity: type='cash', isDefault=true (create via initial setup)
// - Online accounts: type='online', full CRUD
// - isDefault=true cannot be deleted
```

---

## 10. BankTransaction Model (`/models/BankTransaction.ts`)
```typescript
interface IBankTransaction {
  bankAccount: ObjectId // ref: BankAccount
  type: 'credit' | 'debit'
  amount: number // INR ₹
  balanceAfter: number // running balance after transaction
  source: 'payment_receipt' | 'transfer' | 'expense' | 'manual'
  sourceRef?: ObjectId // ref to PaymentReceipt, Expense, or other BankTransaction (for transfer)
  sourceLabel?: string // human readable source description
  transferTo?: ObjectId // ref: BankAccount (if source=transfer)
  transactionDate: Date
  notes?: string
  createdBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
```

---

## 11. Expense Model (`/models/Expense.ts`)
```typescript
interface IExpense {
  title: string // free text, required
  amount: number // INR ₹
  paidFrom: ObjectId // ref: BankAccount (cash or online)
  expenseDate: Date
  remark?: string
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - On create → debit from selected BankAccount
// - On edit → reverse old debit, create new debit
// - On delete → reverse debit
```

---

## 12. ChinaPerson Model (`/models/ChinaPerson.ts`)
```typescript
interface IChinaPerson {
  name: string // required
  isDefault: boolean // true for JACK — cannot be deleted
  currentBalance: number // in RMB ¥, can be negative
  createdBy: ObjectId // ref: User
  updatedBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
// Rules:
// - Default china person: isDefault=true, cannot be deleted
// - Additional persons: full CRUD
// - Balance in RMB ¥ only
```

---

## 13. ChinaPersonTransaction Model (`/models/ChinaPersonTransaction.ts`)
```typescript
interface IChinaPersonTransaction {
  chinaPerson: ObjectId // ref: ChinaPerson
  type: 'pay_in' | 'pay_out'
  amount: number // in RMB ¥
  balanceAfter: number // running balance in RMB ¥
  transactionDate: Date
  notes?: string
  createdBy: ObjectId // ref: User
  createdAt: Date
  updatedAt: Date
}
```

---

## Initial setup

Ensure these exist (create via app or direct DB if needed):
1. At least one User with role `owner`.
2. Cash BankAccount: `{ accountName: 'Cash', type: 'cash', isDefault: true, currentBalance: 0 }`.
3. Default ChinaPerson: `{ name: 'JACK' or 'Sophia', isDefault: true, currentBalance: 0 }`.
