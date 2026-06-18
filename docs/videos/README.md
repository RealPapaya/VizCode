# Demo Video Assets

Large demo videos are stored here locally but are ignored by git.

Current GitHub Release asset names:

- `VizcodeDemo.mp4`
- `VizcodeDemo2.mp4`

Upload them to the latest release, then link visitors to:

```text
https://github.com/RealPapaya/VizCode/releases/latest
```

Direct asset links can also be used after upload:

```text
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo.mp4
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo2.mp4
```

## Inline README Video

The README embeds the release MP4 files directly with HTML video tags:

```html
<video src="https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo.mp4" controls width="100%"></video>
<video src="https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo2.mp4" controls width="100%"></video>
```

If you rename release assets later, update those filenames in `README.md`.
