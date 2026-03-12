// Ensure all Mongoose models are registered on the active connection.
// This file is safe to import multiple times; models are guarded internally.

import '@/models/User'
import '@/models/Product'
import '@/models/IndiaProduct'
import '@/models/BuyingEntry'
import '@/models/IndiaBuyingEntry'
import '@/models/Container'
import '@/models/SellBill'
import '@/models/SellBillItem'
import '@/models/Company'
import '@/models/PaymentReceipt'
import '@/models/BankAccount'
import '@/models/BankTransaction'
import '@/models/Cash'
import '@/models/CashTransaction'
import '@/models/ChinaBankTransaction'
import '@/models/ChinaPerson'
import '@/models/ChinaPersonTransaction'
import '@/models/BuyingPayment'
import '@/models/IndiaBuyingPayment'
import '@/models/Expense'
import '@/models/Liability'

export {}

