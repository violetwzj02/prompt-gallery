# Prompt 风格图鉴

把 [Nihilist-ZIO/prompt-library](https://github.com/Nihilist-ZIO/prompt-library) 做成可浏览、可搜索、可扩展的静态网页图鉴。

内容源自原仓库 · **CC BY 4.0**。

## 本地运行

```bash
cd prompt-gallery
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

浏览器打开 `http://localhost:5173`。

生产构建：

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

`dist/` 可直接丢到 GitHub Pages / 任意静态托管（`vite.config.ts` 已设 `base: './'`）。

## 数据

权威条目来自相邻仓库的 `PROMPT_MASTER.md`（锚点解析，与 `build_xlsx.py` 一致）。

重新生成 JSON：

```bash
# 默认读取 ../prompt-library/PROMPT_MASTER.md
npm run parse
```

输出：`public/data/prompts.json`。

## 封面图

- 六大类氛围封面：`public/covers/categories/{renwu,changjing,goutu,texiao,zhoubian,yishu}.svg`
- 卡片默认 = 类别封面 + 基于条目 `id` 的稳定配色/几何纹理
- 真实封面：把图片放到 `public/covers/entries/<id>.jpg`（或 png），并在 `prompts.json` 对应条目把 `cover` 设为 `covers/entries/<id>.jpg`
- 前端「添加风格」面板支持本地上传封面（base64 存 localStorage）

## 添加新风格

1. **快速预览（网页内）**：点「添加风格」→ 填标题 / 大类 / 用途 / 正文 / 可选封面 → 加入图鉴。数据在 localStorage。可「导出 prompts.json」下载。
2. **正式入库（推荐）**：按原仓库流程改 `cat_*.md` / `PROMPT_MASTER.md`，再 `npm run parse` 刷新 JSON。

## 技术

Vite + React + TypeScript · 纯静态 · 中文界面
