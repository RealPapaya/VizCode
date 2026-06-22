# Demo Media Assets

Large demo videos are stored here locally but are ignored by git. README-friendly animated previews are committed under `docs/images/`.

Current local source files:

- `demo1.mp4`
- `demo2.mp4`

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

## README Media Strategy

GitHub does not render release download URLs as inline video players in README files; they show up as "Open .mp4" links. Keep release links as the full-quality fallback:

```text
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo.mp4
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo2.mp4
```

For a GitNexus-style inline video player, upload the MP4 as a GitHub user attachment, then put the generated URL on its own line in `README.md`:

```text
https://github.com/user-attachments/assets/<asset-id>
```

One way to get that URL:

1. Open the README editor, an issue, or a PR comment on GitHub.
2. Drag the MP4 into the editor and wait for GitHub to upload it.
3. Copy the generated `https://github.com/user-attachments/assets/...` URL.
4. Replace the animated WebP preview in `README.md` with that bare URL.

Until those attachment URLs exist, use animated WebP previews so the README still has visible motion:

```bash
ffmpeg -y -i docs/videos/demo1.mp4 -vf "fps=12,scale=1280:-1:flags=lanczos" -c:v libwebp -lossless 0 -q:v 72 -compression_level 6 -loop 0 -an docs/images/vizcode-demo-scan.webp
ffmpeg -y -t 30 -i docs/videos/demo2.mp4 -vf "fps=10,scale=1280:-1:flags=lanczos" -c:v libwebp -lossless 0 -q:v 62 -compression_level 6 -loop 0 -an docs/images/vizcode-demo-explore.webp
```

If you rename release assets later, update those filenames in `README.md`.
