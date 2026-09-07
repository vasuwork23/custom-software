const fs=require('fs'), jwt=require('jsonwebtoken'), {MongoClient}=require('mongodb');
const env=Object.fromEntries(fs.readFileSync(__dirname+'/.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
(async()=>{const c=new MongoClient('mongodb://localhost:27017');await c.connect();
const role=process.argv[2]||'owner';
const q = role==='owner' ? {role:'owner'} : {email:role+'@qa.local'};
const u=await c.db('import-export-qa').collection('users').findOne(q);
console.log(jwt.sign({userId:String(u._id),email:u.email,role:u.role},env.JWT_SECRET,{expiresIn:'120m'}));await c.close();})();
