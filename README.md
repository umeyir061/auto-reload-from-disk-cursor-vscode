# Auto Reload From Disk (Cursor/VS Code)

Auto-reloads open editors when files change on disk, but only when the document is not dirty.

Designed for high-churn external files (for example logs updated by another process), including workspace-external files.

Compatibility: Works on editors that support the VS Code Extension API (for example Cursor and Visual Studio Code).

## Features

- Reload open files on external changes.
- Works for files both inside and outside the workspace.
- Protects unsaved changes (`dirty` documents are not auto-overwritten).
- Status bar toggle: `Auto Refresh: ON/OFF`.
- Optional fallback polling for environments where file watch events are unreliable.

## Important Note

Even when this extension is OFF (or uninstalled), editors like Cursor/VS Code may still update file content automatically due to their built-in external file change behavior.

This extension controls only its own reload logic.

## Commands

- `Auto Reload: Reload Active File From Disk`
- `Auto Reload: Toggle On/Off`

## Settings

- `autoReloadFromDisk.enabled` (boolean, default: `true`)
- `autoReloadFromDisk.glob` (string, default: `**/*`)
- `autoReloadFromDisk.notifyOnDirty` (boolean, default: `true`)
- `autoReloadFromDisk.stealFocusOnReload` (boolean, default: `false`)
- `autoReloadFromDisk.pollIntervalMs` (number, default: `1000`)
- `autoReloadFromDisk.debounceMs` (number, default: `300`)
- `autoReloadFromDisk.debugLogs` (boolean, default: `false`)

## Development

```bash
npm install
npm run compile
```

## Package VSIX

```bash
npm run package
```

This generates a `.vsix` file in the project root.

## Install In Cursor/VS Code

1. Open command palette.
2. Run `Extensions: Install from VSIX...`
3. Select generated `.vsix`.
4. Reload window.

## License

MIT

---

## Turkce

Diskte degisen dosyalari, editor dirty degilse otomatik yeniler.

Uyumluluk: VS Code Extension API destekleyen editorlerde calisir (ornegin Cursor ve Visual Studio Code).

### Ozellikler

- Dis degisiklikte acik dosyayi yeniler.
- Workspace ici ve disi dosyalarda calisir.
- Kaydedilmemis degisiklikleri (dirty) korur.
- Durum cubugunda `Auto Refresh: ON/OFF` anahtari vardir.
- Gerekirse polling fallback ile degisiklik yakalar.

### Onemli Not

Bu eklenti OFF olsa bile (hatta kaldirilsa bile), Cursor/VS Code kendi yerlesik dis dosya degisimi davranisi nedeniyle dosya icerigini otomatik guncelleyebilir.

Bu eklenti yalnizca kendi reload mantigini kontrol eder.

### Komutlar

- `Auto Reload: Reload Active File From Disk`
- `Auto Reload: Toggle On/Off`

### Ayarlar

- `autoReloadFromDisk.enabled` (boolean, varsayilan: `true`)
- `autoReloadFromDisk.glob` (string, varsayilan: `**/*`)
- `autoReloadFromDisk.notifyOnDirty` (boolean, varsayilan: `true`)
- `autoReloadFromDisk.stealFocusOnReload` (boolean, varsayilan: `false`)
- `autoReloadFromDisk.pollIntervalMs` (number, varsayilan: `1000`)
- `autoReloadFromDisk.debounceMs` (number, varsayilan: `300`)
- `autoReloadFromDisk.debugLogs` (boolean, varsayilan: `false`)
