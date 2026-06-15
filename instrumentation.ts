export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const dns = await import('dns')
    // ISP DNS (Reliance router) can't resolve MongoDB Atlas SRV records.
    dns.setServers(['8.8.8.8', '8.8.4.4'])
  }
}
