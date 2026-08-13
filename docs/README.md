# docs/ — 文件索引

專案的長篇文件都放這裡；根目錄只留 harness / 建置工具會讀到的檔案。

| 檔案 | 內容 |
|------|------|
| `REMAINING_PARSERS.md` | 尚未支援或待強化的語言 parser 清單與優先序 |
| `SkillMaker.md` | 如何撰寫 `.claude/skills/` 底下的 skill（參考資料，不需常改） |
| `plans/plan-harness-scan.md` | harness_scan 評分機制的設計與驗證紀錄 |
| `images/` | README 用的截圖 / demo 圖 |
| `videos/` | demo 影片（`*.mp4` 已 gitignore，大檔放 GitHub Releases） |

## 不在這裡的重要文件

| 檔案 | 位置 | 為什麼不能搬 |
|------|------|------------|
| `README.md` `LICENSE` `CHANGELOG.md` | 專案根目錄 | 慣例位置 |
| `CLAUDE.md` `AGENTS.md` `GEMINI.md` | 專案根目錄 | 各 harness 只讀根目錄；也是 `src/core/harness_scan.py` 的 instruction 計分依據 |
| `LESSONS.md` | 專案根目錄 | `harness_scan._probe_memory_learning()` 硬性檢查根目錄的 `LESSONS.md`（5 分 + dated-slug 格式 4 分） |
| `memory.md` | `.claude/memory/` | 同樣被 `harness_scan` 計分，根目錄 `memory*.md` 與 `.claude/memory/*.md` 兩處等價（各 2 分） |

> 動根目錄的檔案前先看 `src/core/harness_scan.py` 的 `_PRINCIPAL` 與各 `_probe_*` 函式 ——
> 這個專案會用自己的評分器掃自己，搬錯位置會讓自己的分數掉下來。
