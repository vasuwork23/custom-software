import mongoose, { Schema, model, models } from 'mongoose'

export interface IExpense {
  _id?: mongoose.Types.ObjectId
  title: string
  amount: number
  paidFrom: mongoose.Types.ObjectId
  expenseDate: Date
  remark?: string
  createdBy: mongoose.Types.ObjectId
  updatedBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ExpenseSchema = new Schema<IExpense>(
  {
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    paidFrom: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true },
    expenseDate: { type: Date, required: true },
    remark: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ExpenseSchema.index({ expenseDate: -1 })
ExpenseSchema.index({ paidFrom: 1, expenseDate: -1 })

if (models.Expense) {
  delete (models as Record<string, mongoose.Model<unknown>>).Expense
}

const Expense = model<IExpense>('Expense', ExpenseSchema)
export default Expense
