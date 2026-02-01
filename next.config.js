/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable React strict mode to prevent double-mounting during development
  reactStrictMode: false,

  // Allow AlphaTab CDN resources
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },

  // Webpack config for AlphaTab
  webpack: (config) => {
    // Handle AlphaTab's worker files
    config.module.rules.push({
      test: /\.worker\.js$/,
      loader: "worker-loader",
      options: {
        name: "static/[hash].worker.js",
        publicPath: "/_next/",
      },
    });

    return config;
  },
};

module.exports = nextConfig;
