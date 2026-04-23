import mongoose, { Schema, model, models } from 'mongoose'

export interface ICounter {
  _id: string
  seq: number
}

const CounterSchema = new Schema<ICounter>(
  { _id: { type: String, required: true }, seq: { type: Number, default: 0 } },
  { _id: true }
)

if (models.Counter) {
  delete (models as Record<string, mongoose.Model<unknown>>).Counter
}

const Counter = model<ICounter>('Counter', CounterSchema)

const BILL_NUMBER_COUNTER_ID = 'sellBillNumber'

/** Get next bill number (atomic). First bill gets 1001. */
export async function getNextBillNumber(): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    BILL_NUMBER_COUNTER_ID,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  )
  return 1000 + (doc?.seq ?? 1)
}

export default Counter
