# Project Rules & Guidelines for Cursor AI

## Project Overview
This is an **Import-Export Business Management System** built for a China-to-India trading business.
The system manages inventory, P&L, accounts, buying/selling, payments, and more.

## Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript (strict mode — no `any` unless absolutely necessary)
- **Database:** MongoDB with Mongoose ODM
- **Authentication:** JWT stored in session storage
- **Styling:** Tailwind CSS + shadcn/ui components
- **State Management:** Zustand
- **Forms:** React Hook Form + Zod validation
- **Tables:** TanStack Table v8
- **Charts:** Recharts
- **PDF Generation:** @react-pdf/renderer
- **WhatsApp:** Meta WhatsApp Business Cloud API
- **Icons:** Lucide React
- **Date Handling:** date-fns
- **HTTP Client:** Axios

## Folder Structure
```
/
├── app/
│   ├── (auth)/
│   │   └── login/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx (dashboard home)
│   │   ├── china-bank/
│   │   ├── products/
│   │   ├── companies/
│   │   ├── sell-bills/
│   │   ├── received-voucher/
│   │   ├── banks/
│   │   ├── reports/
│   │   ├── expenses/
│   │   ├── jack/
│   │   └── users/
│   └── api/
│       ├── auth/
│       ├── china-bank/
│       ├── products/
│       ├── buying-entries/
│       ├── sell-bills/
│       ├── companies/
│       ├── received-voucher/
│       ├── banks/
│       ├── expenses/
│       ├── jack/
│       ├── reports/
│       └── users/
├── components/
│   ├── ui/ (shadcn components)
│   ├── layout/
│   ├── china-bank/
│   ├── products/
│   ├── companies/
│   ├── sell-bills/
│   ├── received-voucher/
│   ├── banks/
│   ├── reports/
│   ├── expenses/
│   ├── jack/
│   └── users/
├── lib/
│   ├── mongodb.ts
│   ├── auth.ts
│   ├── utils.ts
│   └── constants.ts
├── models/
│   ├── User.ts
│   ├── Product.ts
│   ├── BuyingEntry.ts
│   ├── SellBill.ts
│   ├── SellBillItem.ts
│   ├── Company.ts
│   ├── PaymentReceipt.ts
│   ├── ChinaBankTransaction.ts
│   ├── BankAccount.ts
│   ├── BankTransaction.ts
│   ├── ChinaPerson.ts
│   ├── ChinaPersonTransaction.ts
│   └── Expense.ts
├── hooks/
├── store/
├── types/
├── middleware.ts
└── .env.local
```

## Coding Rules — MUST FOLLOW

### General
- Every file must use **TypeScript** with proper types
- All API routes must have **try/catch** error handling
- All forms must use **React Hook Form + Zod**
- All monetary values stored as **numbers** in DB, displayed formatted in UI
- Dates stored as **Date objects** in MongoDB
- All API responses follow this structure:
```typescript
// Success
{ success: true, data: any, message?: string }
// Error
{ success: false, error: string, message: string }
```

### Authentication
- Every API route (except /api/auth/login) must verify JWT via middleware
- JWT payload contains: `{ userId, role, email }`
- Role hierarchy: Owner > Admin > Manager > Viewer
- Block account after 10 failed login attempts — only Owner can unblock

### MongoDB
- Always use Mongoose models, never raw MongoDB driver
- All models must have `createdAt`, `updatedAt` (via timestamps: true)
- All models must have `createdBy` and `updatedBy` referencing User
- Use `.lean()` for read-only queries for performance
- Always handle mongoose connection properly via `/lib/mongodb.ts`

### UI Rules
- Use shadcn/ui components as base
- All tables use TanStack Table with pagination, sorting, filtering
- All forms show validation errors inline
- All delete actions require confirmation dialog
- All monetary values display with ₹ prefix (INR) or ¥ prefix (RMB) where applicable
- Negative balances show in 🔴 red with warning badge
- Loading states on every async action
- Toast notifications for success/error on every action

### FIFO Logic
- FIFO is applied at selling time based on `buyingEntry.createdAt` ascending
- Only entries with `warehouseStatus = 'india_warehouse'` are available for sale
- Each `SellBillItem` stores `fifoBreakdown` array showing which buying entries were consumed
- On edit/delete of sell bill → reverse FIFO and recalculate

### Auto Calculations (never trust frontend, always recalculate on backend)
- `totalQty = totalCtn * qty`
- `totalCbm = cbm * totalCtn`
- `totalWeight = totalCtn * weight`
- `totalAmount = totalQty * rate`
- `remainingAmount = totalAmount - givenAmount`
- `totalCarrying = totalCbm * carryingRate`
- `perPisShipping = totalCarrying / totalQty`
- `rmbInrPurchase = rate * avgRmbRate`
- `finalCost = rmbInrPurchase + perPisShipping`

## Environment Variables (.env.local)
```
MONGODB_URI=
JWT_SECRET=
JWT_EXPIRY=7d
WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
COMPANY_NAME=Your Company Name
COMPANY_ADDRESS=Your Address
COMPANY_PHONE=Your Phone
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
