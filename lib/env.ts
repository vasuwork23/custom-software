const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET', 'JWT_EXPIRY'] as const

type RequiredEnvKey = (typeof requiredEnvVars)[number]

export const env: Record<RequiredEnvKey, string> = {} as Record<
  RequiredEnvKey,
  string
>

for (const key of requiredEnvVars) {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Please set it in .env.local`
    )
  }
  env[key] = value
}

// Optional WhatsApp-related vars – log a warning if missing
const optionalWhatsappVars = ['WHATSAPP_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']

for (const key of optionalWhatsappVars) {
  if (!process.env[key]) {
    // eslint-disable-next-line no-console
    // console.warn(
    //   `[env] Optional WhatsApp env var ${key} is not set. WhatsApp features may be disabled.`
    // )
  }
}

export default env

