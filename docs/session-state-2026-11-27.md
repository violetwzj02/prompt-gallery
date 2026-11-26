# prompt-gallery 会话交接记录（2026-11-27 暂停点）

> 目的：换人 / 隔天继续时，只看这一份就能接上。所有数字为 2026-11-27 02:20（Asia/Shanghai）实测。

## 一、线上状态

| 项 | 值 |
| --- | --- |
| 站点 | https://violetwzj02.github.io/prompt-gallery/ |
| 入口 JS | `assets/index-CDljyaLS.js`（含 Supabase key、Google client id） |
| 源码分支 | `main` @ `e08d124` |
| 发布分支 | `gh-pages` |
| 相册总记录 | **2177** |
| 分类记录 | 47（其中 custom 约 30） |

## 二、素材资产（云端相册）

| 分类 | 条数 | Drive 位置 |
| --- | --- | --- |
| 申鹤·姿势库 | 630 | Drive 文件夹「申鹤·姿势库」 |
| 待归类 | 533 | Drive 文件夹「待归类」 |
| 露西 / 申鹤 / 蒂法 / 甘雨 | 322 / 174 / 84 / 73 | 各自角色文件夹 |
| 视频 | 21 | Drive 文件夹「视频」 |

覆盖率核对：云盘文件 ↔ 库记录逐条比对，缺口 0（2026-11-27 02:15 复核）。

## 三、本机关键路径

| 用途 | 路径 |
| --- | --- |
| 申鹤新批次原图 | `I:\wangzhanbending\grok-gen\申鹤\`（631 张 + `ledger.json` + `names.json`） |
| 原始导出/候选 | `I:\wangzhanbending\grok-gen\申鹤-raw\` |
| 数据库快照 | `I:\wangzhanbending\backup\album_items-2026-11-27.json`、`album_categories-2026-11-27.json` |
| 提示词批次文件 | `I:\wangzhanbending\prompts-申鹤-P001起-30条.txt`、`prompts-申鹤-P007起-60条.txt` |
| 凭据（勿入库） | `I:\wangzhanbending\creds.json`（Drive token + Supabase 会话）、`.grok_cookie` |
| 生成工作区 | `D:\deepseek win\work\`（worklist.json、poses.js、driver.js、worker.js） |
| 仓库 | `D:\deepseek win\prompt-gallery\` |

## 四、本轮做完的事

1. 相册分页修复：`fetchAlbumItems` 改为 `range` 翻页，解决超过 1000 行后抽屉张数变 0 / 空文件夹。
2. 空抽屉过滤：没有条目的角色不再渲染成「空文件夹」卡片。
3. 「申鹤·姿势库」独立大类：建 `album_categories` 记录 + 311 条补 `18+` 标记。
4. 待归类标签与抽屉数量对齐：533 行补 `18+`（此前只有 59 行带，导致 59 vs 533）。
5. 抓取通道打通的正确姿势（重要）：
   `GET /rest/assets?pageSize=24&orderBy=ORDER_BY_CREATE_TIME&sortDirection=SORT_DIRECTION_DESCENDING&source=SOURCE_ANY&isLatest=true&includeImagineFiles=true&pageToken=…`
   —— 缺 `includeImagineFiles=true` 时看不到 Imagine 生成图；`pageSize` 必须 ≤24，否则只返回 1 条。
6. 解析器容错：全半角统一 → 去尾部括号 → 唯一子串兜底 → **视角缺失时记 `na`**；任何解析失败写 `unparsed.json`，不再静默跳过（此前因此漏 320 张）。
7. 申鹤批次入库：631 张本地 → Drive 631 → 库 630（1 张早期探测图未入库）。

## 五、已知欠账 / 下次接手先看这里

1. **首页未更新**：按用户要求，申鹤新批次只进云端相册，首页 18+ 卡片仍是旧的 276 张。
2. **视频播放 UI**：已支持 `<video>`，但视频条目 `mime_type` 为空，网格靠 Drive 缩略图，属已知表现。
3. **Supabase refresh token 会轮换**：`creds.json` 里的 `refresh_token` 一次性有效，报 `refresh_token_already_used` 时需用户重新从 `tools/auth.html` 导出会话。
4. **Drive token 1 小时过期**：属 Google 约束；方案 A（refresh token + client secret）尚未配置。
5. **自动化生成未打通**：网页端提交按钮 `aria-label="提交"` 能找到、能点击，但文本进的是聊天输入框而不是 Imagine 输入框，导致不触发生成。下次要么定位 Imagine 自己的输入节点，要么抓一次真实生成请求改走纯 HTTP。
6. **组合覆盖**：631 张落 58 个「姿势+视角」组合，P001–P019 区间；俯视/仰视仍偏少。

## 六、可复用脚本（`prompt-gallery/scripts/`）

| 脚本 | 作用 |
| --- | --- |
| `ingest_ids_tolerant.py` | 按 assetId 抓图 + 容错解析姿势/视角 + 下载命名 |
| `album_fast_upload.py` | 并发上传 + 幂等写库（`on_conflict=drive_file_id`） |
| `album_reconcile.py` | 按云盘实况补齐缺失记录 |
| `crawl_assets_batch.py` | 遍历 `/rest/assets` 找本批（需带上第五节第 5 条的参数） |
| `rename_exported_batch.py` | 对已导出到本地的 assetId 文件重命名 |
| `quyi_cards_from_local.py` | 由本地原图生成首页卡片 + WebP 封面 |
| `quyi_meta_from_album.py` | 由相册数据生成首页 18+ 子导航 |

## 七、恢复步骤（下次开工）

```bash
cd "D:/deepseek win/prompt-gallery"
git pull            # 取最新 main
npm run build       # 需要 .env（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_GOOGLE_CLIENT_ID）
```

- 上传前确认 `I:\wangzhanbending\creds.json` 里的 Drive token 未过期（1 小时）
- Supabase 报 401 时执行 `POST /auth/v1/token?grant_type=refresh_token`，或用 `tools/auth.html` 重新导出
