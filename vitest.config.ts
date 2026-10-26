// Unit tests (yarn test): pure logic in Node, no browser or GPU. The app's Vite config is the
// base, so `three` resolves to the same WebGPU build the app bundles.
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      restoreMocks: true,
    },
  }),
)
