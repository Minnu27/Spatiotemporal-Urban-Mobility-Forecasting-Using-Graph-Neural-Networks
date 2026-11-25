import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/api/{forecast,health}': [
      './model/**/*',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1',
    ],
  },
  outputFileTracingExcludes: {
    '/*': ['./.env*', './node_modules/onnxruntime-node/bin/napi-v6/darwin/**/*', './node_modules/onnxruntime-node/bin/napi-v6/win32/**/*', './node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**/*'],
  },
  serverExternalPackages: ['gtfs-realtime-bindings', 'onnxruntime-node'],
  async headers() { return [{ source: '/:path*', headers: [
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
  ]}]; },
};
export default config;
