import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/lib/**/*.test.ts'],
    // The local-qualification modules gate their test-only entry points behind
    // NODE_ENV === 'test' so production cannot choose its own storage root or
    // reset its own budget. Vitest does not set NODE_ENV itself, so without
    // this the guards fire during a normal run and those suites fail on a
    // configuration technicality rather than a real defect.
    env: { NODE_ENV: 'test' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
