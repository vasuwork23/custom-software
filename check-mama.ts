import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db;
  const accounts = await db.collection('bankaccounts').find({ accountName: 'MAMA GPAY' }).toArray();
  console.log("MAMA GPAY:", accounts);
  if (accounts.length > 0) {
    const txs = await db.collection('banktransactions').find({ bankAccount: accounts[0]._id }).sort({ transactionDate: 1, createdAt: 1 }).toArray();
    let r = 0;
    for (let t of txs) {
      if (t.type === 'credit') r+=t.amount;
      else r-=t.amount;
      console.log(t.transactionDate, t.type, t.amount, "=>", r, "(saved balanceAfter:", t.balanceAfter, ")");
    }
  }
  process.exit(0);
};
run();
