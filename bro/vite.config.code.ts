import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        target: 'esnext',
        outDir: 'dist',
        emptyOutDir: false, // preserve ui.html from previous build
        lib: {
            entry: 'src/plugin/main.ts',
            formats: ['iife'],
            name: 'code',
            fileName: () => 'code.js',
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
                // No exports needed — Figma runs this as a script
                exports: 'none',
            },
        },
    },
});
