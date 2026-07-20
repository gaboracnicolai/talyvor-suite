import type { Config } from 'tailwindcss'
import preset from '@talyvor/ui/preset'

export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // scan the design system's source so its classes are generated
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config
