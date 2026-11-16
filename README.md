# Prompt 风格图鉴

把 [Nihilist-ZIO/prompt-library](https://github.com/Nihilist-ZIO/prompt-library) 做成可浏览、可搜索、可扩展的静态网页图鉴。

在线预览：https://violetwzj02.github.io/prompt-gallery/

内容源自原仓库 · **CC BY 4.0**。

源库 106 条主条目会按合集拆成可独立复制的子 Prompt（例如「仙侠人物特效」35 条、「短剧景别构图」30 条），当前解析结果为 **192** 张卡片。

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

权威条目来自相邻仓库的 `PROMPT_MASTER.md`（锚点解析，与 `build_xlsx.py` 一致）。合集条目会再拆成子 Prompt，写入 `public/data/prompts.json` 与 `public/data/meta.json`。

```bash
# 默认读取 ../prompt-library/PROMPT_MASTER.md
npm run parse
```

拆分规则（独立可复制的子提示词才拆；分镜脚本、多层配方仍保持一条）：

- 仙侠人物特效 ×35、短剧景别构图 ×30
- 设计可视化 ×5、脸模 ×4、精修五大词（现 4 条，源库注明缺第 5 条）
- 黑底彩色手写艺术字 ×7、巨构提示词（神龙天宫 + 未来×4）、未来景观 ×4

源库中标注的 OCR 重复条目会保留为独立卡片，并带「与 xx 内容相同」说明。

## 界面

左侧筛选栏：大类、合集、媒介、画幅、风格标签。顶部可搜索，支持疏/密网格。卡片打开后可复制全文或纯提示词，左右键在当前筛选结果中切换。地址栏 hash 可分享某一张卡片及当前筛选，例如 `#/texiao-1-12`。

## 封面图

- 六大类氛围封面：`public/covers/categories/{renwu,changjing,goutu,texiao,zhoubian,yishu}.jpg`
- 卡片默认 = 类别封面 + 基于合集与条目 `id` 的稳定配色/几何纹理（同一合集色调相近，子条目纹理不同）
- 真实封面：把图片放到 `public/covers/entries/<id>.jpg`（或 png），并在 `prompts.json` 对应条目把 `cover` 设为 `covers/entries/<id>.jpg`
- 前端「添加风格」面板支持本地上传封面（base64 存 localStorage），并可填写大类、合集与标签

## 添加新风格

1. **快速预览（网页内）**：点「添加风格」→ 填标题 / 大类 / 媒介 / 可选合集与标签 / 正文 / 可选封面 → 加入图鉴。数据在 localStorage。可「导出 prompts.json」下载。
2. **正式入库（推荐）**：按原仓库流程改 `cat_*.md` / `PROMPT_MASTER.md`，再 `npm run parse` 刷新 JSON。

## 技术

Vite + React + TypeScript · 纯静态 · 中文界面
