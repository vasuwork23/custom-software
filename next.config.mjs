/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@react-pdf/renderer'],
    instrumentationHook: true,
  },
  images: {
    domains: ['www.bucketlistly.blog'],
  },
}

export default nextConfig
