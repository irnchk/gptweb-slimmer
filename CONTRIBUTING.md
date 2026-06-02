# Contributing

Thanks for helping improve ChatGPT Long Chat Slimmer.

## Good First Contributions

- Report when ChatGPT page changes break turn detection.
- Share browser/version details for performance regressions.
- Improve selectors, accessibility, localization, or documentation.
- Add lightweight tests or reproducible fixtures for DOM-shape changes.

## Development

1. Clone the repository.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load this folder as an unpacked extension.
5. Test changes on `chatgpt.com` and, when relevant, `chat.openai.com`.

Run a syntax check before opening a pull request:

```sh
node --check content-script.js
node --check popup.js
```

## Privacy Expectations

The extension should remain local-first:

- Do not collect message content.
- Do not send data to external services.
- Do not intercept network responses unless a future design discussion explicitly justifies it.

## Pull Request Notes

Please include:

- what changed
- why it changed
- browser and ChatGPT URL tested
- before/after behavior for UI or performance changes
