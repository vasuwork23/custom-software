import mongoose, { Schema, model, models } from 'mongoose'

export type ResetRunStatus =
  | 'snapshot'      // safety copies taken, nothing changed yet
  | 'previewed'     // plan built and shown
  | 'executed'      // swapped into live
  | 'failed'
  | 'rolled_back'

export interface IResetRun {
  _id?: mongoose.Types.ObjectId
  status: ResetRunStatus
  startedAt: Date
  completedAt?: Date
  /** Folder on disk holding the mongodump, used by restore.sh. */
  snapshotPath?: string
  /** Sibling database holding a frozen copy of everything as it was. */
  archiveDbName?: string
  /** Document counts per collection at the moment the snapshot was taken. */
  countsBefore?: Record<string, number>
  /** Locked value written off as spent when trimmed entries lost their sold cartons. */
  sunkLockedAmount?: number
  /**
   * Total lockedAmount still carried by surviving entries at the moment of the
   * reset. The China Bank ledger collapses to one opening row, so its debits no
   * longer account for locked stock; this is the baseline that keeps the
   * "locked value equals China Bank debits" check meaningful afterwards.
   */
  carriedLockedAmount?: number
  notes?: string
  error?: string
  createdBy: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ResetRunSchema = new Schema<IResetRun>(
  {
    status: {
      type: String,
      required: true,
      enum: ['snapshot', 'previewed', 'executed', 'failed', 'rolled_back'],
    },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
    snapshotPath: { type: String },
    archiveDbName: { type: String },
    countsBefore: { type: Schema.Types.Mixed },
    sunkLockedAmount: { type: Number },
    carriedLockedAmount: { type: Number },
    notes: { type: String },
    error: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ResetRunSchema.index({ createdAt: -1 })

if (models.ResetRun) {
  delete (models as Record<string, mongoose.Model<unknown>>).ResetRun
}

const ResetRun = model<IResetRun>('ResetRun', ResetRunSchema)
export default ResetRun
