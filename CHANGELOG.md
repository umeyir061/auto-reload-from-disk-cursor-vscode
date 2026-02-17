# Changelog

## 0.0.3

- Updated extension marketplace description for clearer Cursor & VS Code positioning.
- Added runtime/performance optimizations:
  - queued external watcher sync to avoid race conditions
  - non-overlapping polling guard
  - selective watcher restarts on relevant config changes

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
