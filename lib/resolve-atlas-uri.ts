/**
 * Converts a mongodb+srv:// URI to a direct mongodb:// URI by resolving
 * SRV and TXT records via DNS-over-HTTPS (Google). This bypasses any local
 * ISP DNS that can't resolve MongoDB Atlas SRV records.
 */
export async function resolveAtlasUri(srvUri: string): Promise<string> {
  const url = new URL(srvUri)
  const hostname = url.hostname

  const [srvRes, txtRes] = await Promise.all([
    fetch(`https://dns.google/resolve?name=_mongodb._tcp.${hostname}&type=SRV`),
    fetch(`https://dns.google/resolve?name=${hostname}&type=TXT`),
  ])

  const srvData = await srvRes.json() as { Answer?: { data: string }[] }
  const txtData = await txtRes.json() as { Answer?: { data: string }[] }

  if (!srvData.Answer || srvData.Answer.length === 0) {
    throw new Error(`Could not resolve SRV records for ${hostname}`)
  }

  const hosts = srvData.Answer.map((record) => {
    const parts = record.data.trim().split(/\s+/)
    // SRV format: priority weight port target
    const port = parts[2]
    const target = parts[3].replace(/\.$/, '')
    return `${target}:${port}`
  })

  const params = new URLSearchParams()
  params.set('ssl', 'true')
  params.set('authSource', 'admin')

  // TXT record typically carries replicaSet and authSource options
  if (txtData.Answer && txtData.Answer.length > 0) {
    const txtOptions = txtData.Answer[0].data.replace(/"/g, '').trim()
    new URLSearchParams(txtOptions).forEach((v, k) => params.set(k, v))
  }

  // Preserve any extra query params from the original URI (e.g. appName)
  url.searchParams.forEach((v, k) => params.set(k, v))

  const db = url.pathname.slice(1) || 'admin'
  const user = url.username
  const pass = encodeURIComponent(decodeURIComponent(url.password))

  return `mongodb://${user}:${pass}@${hosts.join(',')}/${db}?${params.toString()}`
}
