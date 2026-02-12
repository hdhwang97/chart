import { defineConfig, Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

/**
 * Figma 플러그인 UI sandbox는 <script type="module">을 지원하지 않음.
 * Vite가 기본으로 출력하는 type="module"과 crossorigin 속성을 제거하는 플러그인.
 */
function figmaScriptCompat(): Plugin {
  return {
    name: 'figma-script-compat',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/ type="module"/g, '')
        .replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src/ui'),
  plugins: [viteSingleFile(), figmaScriptCompat()],
  build: {
    // Figma sandbox 호환성을 위해 es2017 사용
    target: 'es2017',
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
  },
});
