/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 段落状态色（与 UI 线框图状态机对应）
        para: {
          todo: '#9ca3af',      // ○ 未开始 灰
          doing: '#3b82f6',     // ✎ 翻译中 蓝
          done: '#22c55e',      // ✓ 已完成 绿
          review: '#f59e0b'     // ⚠ 存疑 橙
        }
      }
    }
  },
  plugins: []
}
