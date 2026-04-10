# ChatGPT Long Chat Slimmer

![English](https://img.shields.io/badge/English-2563eb?style=for-the-badge)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-334155?style=for-the-badge)](./README.ko.md)

A Chrome extension that reduces rendering load in long ChatGPT web conversations by unmounting older turns from the DOM.

## How It Works

- It finds the conversation turn container on the ChatGPT web page.
- It keeps only the latest N turns mounted in the DOM and detaches older turns from the page.
- You can use `Load Older`, `Latest Only`, and `Show All` from the top placeholder or the collapsible bottom-right dock.
- The number of kept turns can be adjusted live from both the popup and the page dock, and settings are stored locally per browser.
- Everything runs entirely inside the browser and does not send data anywhere.

## Installation

1. Download or extract this folder.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select this folder: `chatgpt-long-chat-slimmer`.

## Usage

- Open a conversation page on `chatgpt.com` or `chat.openai.com`.
- Click the extension icon and adjust the number of turns to keep and the `Load Older` batch size in real time.
- The default behavior keeps the most recent 40 turns mounted.
- If you want to revisit older turns, use `Load Older` from the top placeholder, the expanded dock panel, or the popup.
- Because settings are stored locally, you can use different limits in Chrome, Edge, Arc, and other Chromium-based browsers.

## Notes

- ChatGPT's web DOM structure is private implementation detail and may change. If it changes significantly, the selectors may need updates.
- This version targets **browser rendering, scrolling, and input lag** reduction rather than server response speed.
- The current implementation uses a safer DOM-based slimming approach and does not intercept network responses.
