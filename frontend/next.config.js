/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  async redirects() {
    return [
      // The dashboard route was renamed to /meet; keep old links working.
      { source: '/dashboard', destination: '/meet', permanent: true },
    ];
  },
};

module.exports = nextConfig;
