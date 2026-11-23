# 诗镜 · Poetry Lens

> 诗词品鉴与修改网站 — 体裁判定 → 格律提示 → 艺术品评 → 改进建议

**在线体验**：<https://yaokx520.github.io/poemweb/>　·　**仓库**：<https://github.com/Yaokx520/poemweb/>

纯前端实现，无需构建、无需后端，双击 `index.html` 即可离线运行。

---

## 功能

- **品鉴台**：输入题目 / 作者 / 正文 → 四卡品鉴报告（体裁判定、格律提示、艺术品评、改进与借鉴），五维评分与朱砂评级印章。
- **跟我写诗**：按体裁 / 风格 / 韵脚辅助创作，经典例作可「换一批」，意象 / 组句 / 手法 / 情绪主旨提示。
- **AI 创作**：生成创作提示词（可复制粘贴），接入智能体 API（DeepSeek / 通义千问 / 智谱 / Kimi / 文心 / MiMo 等）产出 2-3 首并按贴合度评分。
- **体裁学堂**：22 种诗体的格律、章法、逐句图注范例与常见错误。
- **词牌查询**：153 词牌词谱、韵位、例词（依龙榆生《唐宋词格律》）。
- **中国诗人**：先秦至近现代 110 位诗人档案，按朝代 / 风格 / 姓名检索。
- **韵脚意象辞典**：字与韵部双向查询、28 条意象库、意象组合造句练习。

## 技术栈

原生 HTML / CSS / JavaScript，无框架、无构建步骤。数据以内嵌 JS 提供：

| 文件 | 内容 |
|---|---|
| `index.html` / `style.css` / `app.js` | 页面、样式与规则引擎 |
| `data-prosody.js` | 平仄字表、入声字表、106 韵部 |
| `data-content.js` | 示例诗、意象库、体裁学堂、风格流派、例作库 |
| `data-cipai.js` | 153 词牌词谱与例词 |
| `data-poets.js` | 中国诗人档案（110 位） |
| `data-ai.js` | AI 创作平台预设、主题与风格 |

## 关注公众号

欢迎关注微信公众号 **「秋轩诗抄」**，获取诗词写作与鉴赏的持续更新：

<p align="center">
  <img src="images/logo.png" alt="秋轩无墨 品牌印章 Logo" width="120">
</p>

![微信公众号「秋轩诗抄」二维码](images/qrcode.jpg)

*微信「扫一扫」上方二维码，或在公众号中搜索「秋轩诗抄」。*

网站页脚也有「关注公众号」入口，点击可弹出二维码并复制公众号名称。

## 许可证

本项目为**双许可**结构：原创代码与文案以 **MIT** 开源，词牌数据文件以 **AGPL-3.0** 分发。版权所有 © 2026 秋轩无墨。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE-AGPL-3.0.txt)

| 部分 | 文件 | 许可证 |
|---|---|---|
| 原创源代码与文案 | `index.html` `style.css` `app.js` `license.html` `data-prosody.js` `data-content.js` `data-poets.js` `data-ai.js` | **[MIT](LICENSE)** |
| 品牌 Logo 与二维码 | `images/*` | **MIT** |
| 词牌格律与例词（改编数据） | `data-cipai.js` | **[AGPL-3.0](LICENSE-AGPL-3.0.txt)** |

- **MIT**：保留版权声明与许可声明，即可自由使用、修改、合并、发布、分发、再许可及销售。
- **AGPL-3.0**：`data-cipai.js` 改编自 [wmjordan/longyusheng.org](https://github.com/wmjordan/longyusheng.org)，须按 AGPL-3.0 分发——保留署名、来源与许可证文本，该文件及其改编物以 AGPL-3.0 条款提供。
- 完整版权署名、逐项许可与第三方归属见 **[版权与许可](license.html)**；第三方署名与保留要求见 **[NOTICE](NOTICE)**。

> **第三方数据**：词牌格律数据（`data-cipai.js`）改编自 [wmjordan/longyusheng.org](https://github.com/wmjordan/longyusheng.org)（AGPL-3.0，原著龙榆生《唐宋词格律》）；诗人档案（`data-poets.js`）来自 [Yaokx520/Literary-personality-test](https://github.com/Yaokx520/Literary-personality-test)。二者版权归原整理者，分发时须随附 `NOTICE` 与 `license.html` 中的署名与来源说明。

## 免责声明

本工具的格律判定、评分与品评为规则引擎结果，仅供学习与创作参考，不构成权威定论。AI 创作功能所生成内容由第三方模型输出，其准确性与版权责任由使用者自行判断。
此项目仅供开源学习，严禁商业用途。项目中的曲目也仅作为演示曲目，严禁商业用途，如有歌曲版权诉求，本项目会下架相关曲目。

---

© 2026 秋轩无墨 · [版权与许可](license.html) · [GitHub](https://github.com/Yaokx520/poemweb/)
