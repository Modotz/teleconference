import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // React is provided by the host app
  external: ['react', 'react-dom'],
  // socket.io-client / mediasoup-client are bundled deps of the SDK
});
