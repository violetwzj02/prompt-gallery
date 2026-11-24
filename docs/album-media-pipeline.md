# 云端相册素材流水线（Grok Imagine → 云端相册 → 图鉴 18+）

本条流水线取代原先手工盘点的方式，四个阶段都可以单独重跑，且都是幂等的：

```
枚举 Grok 媒体库  →  展开嵌套子图  →  下载  →  上传 Drive + 写 Supabase  →  重新生成首页 18+ 卡片
scripts/grok_survey.py list / manifest / download      scripts/album_import.py     scripts/ingest_quyi.py
```

## 0. 凭据（只从环境变量读，不落盘、不进仓库）

| 变量 | 用途 |
| --- | --- |
| `GROK_COOKIE` | `sso=...; sso-rw=...`，grok.com 登录态 |
| `GOOGLE_REFRESH_TOKEN` + `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Drive 读写（或临时用 `GOOGLE_ACCESS_TOKEN`） |
| `ALBUM_DRIVE_FOLDER_ID` | 云端相册根目录 id（缺省按名称「风格 Prompt 图鉴·云端相册」在根目录查找） |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | 读写 `album_items`（或改用 `SUPABASE_ADMIN_JWT`） |

Drive 权限必须是相册页面**同一个 OAuth 客户端**（`drive.file`）。别的客户端，哪怕同一账号，上传的文件相册也看不见。

## 1. 枚举 + 展开嵌套

```bash
python scripts/grok_survey.py list     --out covers-inbox/quyi-survey/raw-posts.json
python scripts/grok_survey.py manifest --out covers-inbox/quyi-survey/imagine-manifest.json
```

`manifest` 会把每个 post 的 `childPosts / images / videos` 全部展开成独立条目——上一轮漏图就是只取了列表首页图。
角色名优先取 Grok 文件夹名，其次从提示词里匹配已知角色；两者都无则留空（进「待归类」，不猜）。

## 2. 下载

```bash
python scripts/grok_survey.py download --outdir covers-inbox/quyi-downloads
```

产物：`stills/<uuid>.jpg`、`videos/<uuid>.mp4`、`posters/<uuid>.jpg`，以及记录 md5 的 `ledger.json`。

## 3. 上传 Drive + 写相册

```bash
python scripts/album_import.py export                       # 先看一眼现有记录
python scripts/album_import.py upload --titles covers-inbox/quyi-survey/titles.json
python scripts/album_import.py rows                         # 只写图片行（相册表 mime_type 只允许图片）
```

- 每个角色在相册根目录下建一个同名文件夹，与首页 18+ 子导航同名同序。
- 上传前按 md5 与云盘已有文件比对，重复的只记账不上传，重跑不会产生第二份。
- `titles.json` 是 `uuid -> 标题` 的映射（角色·画面特色），标题同时用于 Drive 文件名和 `album_items.title`。

## 4. 回写标题（含既有条目）

```bash
python scripts/album_import.py titles --map covers-inbox/album/titles-by-id.json --key id
```

`--key id` 改已有相册条目；`--key drive` 按 Drive 文件 id 改。空标题会被跳过。

## 5. 刷新首页 18+ 卡片

```bash
python scripts/ingest_quyi.py --write-display-covers   # 生成 quyi-cards.json / quyi-meta.json / 展示图
```

`ingest_quyi.py` 读的是 `covers-inbox/quyi-survey/imagine-manifest.json` 和 `covers-inbox/quyi-downloads/`，
因此第 1、2 步输出必须落在默认路径（或用 `--write-display-covers` 前先同步过去）。

## 6. 卡片命名（角色 · 画面特色）

```bash
python scripts/quyi_titles.py            # 预览：每张卡的旧名 → 新名
python scripts/quyi_titles.py --write    # 写入 public/data/quyi-cards.json
```

标题只从该卡自己的提示词里提取「姿态 / 手部 / 机位 / 场景」四类信息（如 `蒂法 · 坐地 分腿V字 双手撑地`），
提示词里没有可用描述时保留原名，不靠编号凑数；同角色同姿态的多张卡自动加（2）（3）区分。
每次 `ingest_quyi.py` 重新生成 `quyi-cards.json` 之后都要再跑一次这一步。

## 7. 给相册里的图片命名（看图取名）

相册条目的标题存在 `album_items.title`，原来直接沿用上传时的 uuid。用三步把它换成「角色 · 画面特色」：

```bash
python scripts/album_import.py export                  # 先导出 items.json
python scripts/album_naming.py fetch                   # 取每个条目的预览图到本地暂存目录 album-thumbs
python scripts/album_naming.py sheet                   # 拼成联系人表 -> sheets/sheet-01.jpg + labels.json
# 看过 sheet 之后写一份 names.json：{"<album_id>": "蒂法·侧身跪坐", ...}
python scripts/album_naming.py apply --map names.json  # 写回 album_items.title
```

- `fetch` 自带续传：已有预览的不重复下载，没取到缩略图的条目会记账并在下次重试。
- `sheet` 每格左上角有 `#001` 形式的编号，`labels.json` 记录「编号 → album_id」，照着编号写名字即可。
- `apply` 只改 `title`，空标题跳过；失败逐条打印不中断。
- 只读预览图，不下载原图、不上传、不改分类。

## 校验

```bash
python scripts/test_grok_survey.py     # 嵌套展开、去重、角色识别
python scripts/test_album_import.py    # 上传/去重/写行/改标题（本地 mock Drive+Supabase）
```

`covers-inbox/` 已在 `.gitignore` 中，原始素材和下载件都不进仓库。
