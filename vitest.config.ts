import { defineConfig } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./test/setup.ts'],
        globals: true,
        include: ['client/src/**/*.test.ts?(x)', 'client/test/**/*.test.ts', 'cdn/**/*.test.ts'],
    },
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, 'client/src'),
            '@shared': path.resolve(import.meta.dirname, 'shared'),
            '@cdn': path.resolve(import.meta.dirname, 'cdn'),
        },
    },
});
