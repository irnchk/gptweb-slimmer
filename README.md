<div align="center">

# 🪶 ChatGPT Long Chat Slimmer

**Keep long ChatGPT conversations fast by unmounting older turns from the DOM.**

[![English](https://img.shields.io/badge/English-2563eb?style=for-the-badge)](./README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-334155?style=for-the-badge)](./README.ko.md)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34a853?style=flat-square)](./manifest.json)
[![Version](https://img.shields.io/badge/version-0.2.0-blue?style=flat-square)](./manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![Chromium](https://img.shields.io/badge/Chrome%20%7C%20Edge%20%7C%20Arc-Chromium-orange?style=flat-square)](#installation)
[![Privacy](https://img.shields.io/badge/data%20sent-none-success?style=flat-square)](#privacy--permissions)

</div>

---

Long ChatGPT threads get slow because **every past turn stays in the page**, and the browser keeps re-rendering all of them. This Chrome extension keeps only the most recent **N** turns mounted and detaches the rest from the DOM, so scrolling, typing, and rendering stay snappy — without touching your messages or the server.

> 💡 This targets **browser-side lag** (rendering, scrolling, input), not server response speed. Hidden turns are simply detached from the page and can be restored at any time.

## Why This Exists

Long AI work sessions often become a browser performance problem before they become a model problem. Developers, students, researchers, and power users can keep a single ChatGPT thread open for days or weeks; eventually the page contains hundreds of rich DOM nodes, code blocks, markdown regions, and controls. That can make scrolling, typing, and switching tabs feel sluggish even on capable machines.

ChatGPT Long Chat Slimmer is a small, local-first tool for that bottleneck. It preserves the conversation in the browser session, avoids network interception, and gives users explicit controls to reveal older turns when they need context again.

## Who It Helps

- Developers using ChatGPT for long debugging, planning, or code review sessions.
- Researchers and students collecting long notes in one conversation.
- Heavy ChatGPT users on Chromium browsers who notice input lag or scroll jank.
- Privacy-conscious users who want a browser-only performance tool.

## ✨ Features

| | Feature |
|---|---|
| ⚡ | **Faster long chats** — keeps only the latest *N* turns in the DOM, detaches older ones |
| 🎚️ | **Live tuning** — change the kept-turn count (2–200) and reflect it instantly on the open tab |
| 👀 | **Restore anytime** — `Load Older`, `Latest Only`, and `Show All` from the popup or page dock |
| 📊 | **Status panel** — see total / shown / hidden turns and the DOM reduction percentage |
| 🌐 | **Bilingual UI** — Korean / English with an `Auto (browser)` option |
| 🔒 | **Local & private** — settings stored per browser, nothing is ever sent anywhere |

## ⚙️ How It Works

1. Finds the conversation turn container on the ChatGPT web page.
2. Keeps only the latest **N** turns mounted and detaches older turns from the page.
3. Surfaces `Load Older`, `Latest Only`, and `Show All` controls in a top placeholder and a collapsible bottom-right dock.
4. Lets you adjust the kept-turn count live from both the popup and the page dock — settings are stored locally per browser.
5. Runs entirely inside the browser and never sends data anywhere.

## 📦 Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select this folder.

## 🚀 Usage

- Open a conversation on `chatgpt.com` or `chat.openai.com`.
- Click the extension icon to adjust the kept-turn count and the `Load Older` batch size in real time.
- By default, the most recent **40 turns** stay mounted.
- To revisit older messages, use `Load Older` from the top placeholder, the expanded dock panel, or the popup.
- Because settings are stored locally, you can keep different limits in Chrome, Edge, Arc, and other Chromium-based browsers.

## 🔧 Settings

| Setting | Default | Range | Description |
|---|---|---|---|
| **Enabled** | `on` | — | Master toggle for slimming |
| **Keep turns** | `40` | 2–200 | How many recent turns stay mounted |
| **Load Older batch** | `20` | 2–200 | How many turns are revealed per `Load Older` click |
| **Language** | `Auto` | Auto / 한국어 / English | UI language for the popup and in-page controls |
| **Status panel** | `on` | — | Show the bottom-right dock with live stats |

### Status panel metrics

`Total turns` · `Shown` · `Hidden` · `DOM reduction %` — refreshed live for the active tab.

## 🔒 Privacy & Permissions

- Everything runs locally in your browser; **no data is collected or transmitted**.
- The extension does not intercept network responses — it only detaches/attaches DOM nodes.
- Requested permissions:
  - `storage` — save your settings locally per browser.
  - `tabs` — apply changes and read status for the active ChatGPT tab.

## 📝 Notes & Limitations

- ChatGPT's web DOM structure is a private implementation detail and may change. If it changes significantly, the selectors may need updating.
- This version targets **browser rendering, scrolling, and input lag** reduction — not server response speed.
- The current implementation uses a safer DOM-based slimming approach and does **not** intercept network responses.

## 🛠️ Maintenance

This project is maintained as a lightweight open-source utility. The most important maintenance work is tracking ChatGPT DOM changes, keeping the extension privacy-preserving, and improving the UI without adding background services.

Near-term priorities:

- Keep turn detection resilient as ChatGPT's markup changes.
- Add small reproducible fixtures for DOM-shape regressions.
- Improve accessibility and keyboard navigation for the popup and dock.
- Collect real-world performance reports from long conversations.

## 🤝 Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development notes, privacy expectations, and suggested first contributions.

## 📄 License

MIT. See [LICENSE](./LICENSE).

## 🗂️ Project Structure

```
gptweb-slimmer/
├── manifest.json        # MV3 manifest (permissions, content script, action)
├── content-script.js    # Core slimming logic, in-page dock & overlay
├── popup.html / .js / .css  # Toolbar popup UI and controls
├── CONTRIBUTING.md      # Contribution guide and privacy expectations
├── LICENSE              # MIT license
└── icons/               # Extension icons (16–128px)
```

---

<div align="center">
<sub>Runs entirely in your browser · No tracking · No data leaves your machine</sub>
</div>
