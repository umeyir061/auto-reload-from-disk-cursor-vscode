# Changelog

## 0.0.2

- Added status bar `Auto Refresh: ON/OFF` toggle.
- Added workspace-external file watching support.
- Added polling fallback for unreliable file watch scenarios.
- Improved dirty-file handling to avoid unintended overwrite.
- Reduced VSIX size via `.vscodeignore`.
- Added project metadata and licensing files for release readiness.

## 0.0.1

- Initial implementation:
  - file change detection
  - auto reload for non-dirty editors
  - manual reload command
