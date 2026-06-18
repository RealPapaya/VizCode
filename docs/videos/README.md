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

## README Video Links

GitHub README strips normal HTML `<video>` tags, so release MP4 files should be linked directly as plain URLs:

```text
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo.mp4
https://github.com/RealPapaya/VizCode/releases/latest/download/VizcodeDemo2.mp4
```

If you rename release assets later, update those filenames in `README.md`.

For a true inline player on GitHub, upload the MP4 into a GitHub issue, PR, discussion, or comment editor and paste the generated `https://github.com/user-attachments/assets/...` URL into the README.
