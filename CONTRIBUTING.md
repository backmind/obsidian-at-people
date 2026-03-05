# Contributing

Contributions are welcome. To keep the process efficient, please follow these guidelines.

## Before opening a PR

Open an issue first for any non-trivial change. This avoids duplicate work and ensures the change aligns with the project direction. For typo fixes or documentation corrections, a PR without prior issue is fine.

## Setup

1. Clone the repo:
```bash
git clone https://github.com/backmind/obsidian-at-people.git
```

2. Symlink or copy the plugin folder into a test vault:
```
<vault>/.obsidian/plugins/at-people/
```

3. Edit `main.js` directly — there is no build step and no dependencies.
4. Reload the plugin in Obsidian (**Settings > Community plugins > At People > Reload**) after each change.

## Pull requests

- Target the `dev` branch, never `main`
- One logical change per PR
- Include a brief description of what changed and why
- If the change affects behavior, describe how to test it manually in the vault

## Reporting bugs

Use the [bug report template](https://github.com/backmind/obsidian-at-people/issues/new?template=bug_report.md). Include Obsidian version, plugin version, and OS.

## Code style

No linter config is enforced. Match the style of surrounding code. Prefer clarity over brevity.
