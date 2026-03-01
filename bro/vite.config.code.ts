import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        // Figma sandbox 호환성을 위해 es2017 사용 (??, ?. 등 ES2020+ 구문 방지)
        target: 'es2017',
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
