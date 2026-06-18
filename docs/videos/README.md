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

## README Demo Reel

GitHub README strips normal HTML `<video>` tags. The README uses an animated WebP instead:

```text
docs/images/demo-reel.webp
```

The full MP4 files are still linked directly below the WebP:

```text
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo.mp4
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo2.mp4
```

To regenerate from the short demo after installing ffmpeg:

```bash
ffmpeg -i docs/videos/demo-short.mp4 -vf "fps=12,scale=960:-1:flags=lanczos" -c:v libwebp -q:v 70 -compression_level 6 -loop 0 -an docs/images/demo-reel.webp
```

If you rename release assets later, update those filenames in `README.md`.
