# maimai DX 找歌 · Song Finder

给 maimai DX **国际版**玩家用的网页：搜一首歌，告诉它你在游戏里用的分类和排序，它告诉你歌在哪个文件夹、从左数第几首、要快速滑动几次再按几下 3 键或 6 键。

A web app for maimai DX International players: search a song, tell it your in-game category and sort, and it tells you which folder to open and how many swipes and button presses reach the song.

网址 / Live: https://lenppqq.github.io/maimaiSongSearch/

## 曲库怎么更新

GitHub Action 每天 06:17 UTC 自动运行 [scripts/fetch_data.py](scripts/fetch_data.py)：

1. 下载 SEGA 官方国际版曲目 JSON 和 otoge-db 的国际版数据。
2. 合并、校验，生成 `site/data/songs.json` 和本次变动 `site/data/changes.json`。
3. 有变化就自动提交，然后发布到 GitHub Pages。没变化只重新发布。

也可以在 GitHub 的 Actions 页面手动点 **Run workflow** 立即更新。

### 数据规则

- **官方数据为准。** 哪些歌在库里、分类、等级、推荐排序都以 SEGA 官方文件为准。
- **新歌从 otoge-db 补。** 官方文件经常落后几个月。otoge-db 标记为国际版、且上线日期晚于官方文件最新日期的歌会补进来，放在所属流派最前面，并标注“位置为估计”。
- **BPM 和上线日期来自 otoge-db。**

### 保护措施：以下情况脚本会失败，网站保持上一版

- 出现未知分类名。需要在脚本的 `GENRES` 里加上。
- 官方数据出现新版本代号，说明国际版升级了。需要在 [data/versions.json](data/versions.json) 加上新版本并改 `intlLatest`。
- 曲目数一次减少超过 3%。确认是游戏真的删歌后，用 `--allow-shrink` 运行一次。
- 官方数据少于 1000 首，或等级、排序字段格式不对。

### 手动修正

机台实测发现数据不对时，改 [data/overrides.json](data/overrides.json)，每次自动更新后都会再套用：

- `exclude`：要去掉的曲目 id。
- `patch`：按 id 改字段。`sort` 用官方编号，写小数可以插到两首之间。
- `add`：两个数据源都没有的曲目。

曲目 id 在 `site/data/songs.json` 里可以查到。

## 本地开发

不需要安装依赖。数据脚本只用 Python 标准库，网页是纯静态文件。

```bash
python3 scripts/fetch_data.py
```

```bash
python3 -m unittest discover -s scripts -p 'test_*.py'
```

```bash
python3 -m http.server 8765
```

然后打开 http://localhost:8765/site/ 看网页，打开 http://localhost:8765/tests/ 跑引擎测试。有 Node 的话也可以运行 `node tests/engine.test.mjs`。

## 未验证的假设

这些在机台上实测之前都是猜的，网页里的“未验证的假设”面板可以调整：

- 推荐排序等于官方数据里的 `sort` 顺序。
- 进入文件夹时光标在第一首。
- 歌曲列表是否首尾相连。
- 一次快速滑动跳过几首，默认 10。
- 文件夹末尾是否有随机选曲格子。
- 曲名文件夹的字母分段：A～D、E～J、K～O、P～S、T～Z。
- 版本文件夹的先后顺序。

数据来源：SEGA 官方国际版曲目数据、[otoge-db](https://github.com/zvuc/otoge-db)。本站与 SEGA 无关。
