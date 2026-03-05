# At People

[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22at-people%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=at-people)
[![Version](https://img.shields.io/github/manifest-json/v/backmind/obsidian-at-people?color=%23483699&logo=obsidian)](https://github.com/backmind/obsidian-at-people/releases)
[![License](https://img.shields.io/github/license/backmind/obsidian-at-people)](./LICENSE)
[![Install in Obsidian](https://img.shields.io/badge/Install%20in%20Obsidian-%23483699?logo=obsidian)](https://obsidian.md/plugins?id=at-people)

A lightweight Obsidian plugin that lets you mention people with `@`, just like you would in a chat or social media. Type `@` followed by a name, pick from the suggestions, and a wiki-link is inserted automatically.

![](./example.png)

## Features

- **Smart fuzzy search** — finds people even with partial input, typos in word order, or accent differences
  - `"john"` matches **John Doe**
  - `"jose"` matches **José García**
  - `"jd"` matches **John Doe** (initials)
  - `"doe jo"` matches **John Doe** (multi-word)
- **Frontmatter aliases** — match people by nicknames or alternate names defined in their YAML frontmatter (opt-in)
- **Backlink-based ranking** — people you reference often appear higher in suggestions, with a slight recency boost for recently edited notes
- **Link selected text** — select any text, run the command **"At-People: Link selected text to person"** from the palette, and convert it into a person link instantly. Assign a hotkey (e.g. `Ctrl+Shift+A`) for even faster linking.
- **Dismiss with Escape** — press `Esc` to dismiss suggestions; they won't reappear until you type a new `@`
- **Auto-create files** — optionally create person files and folders on the fly when selecting a suggestion
- **Flexible folder modes** — store people as flat files, per-person folders, or grouped by last name

## Installation

### From Community Plugins

1. Open [At People in the Obsidian plugin directory](https://obsidian.md/plugins?id=at-people), or go to **Settings > Community plugins** and search for **"At People"**
2. Click **Install**, then **Enable**

### Manual

1. Download the latest release from [Releases](https://github.com/backmind/obsidian-at-people/releases)
2. Extract to `<vault>/.obsidian/plugins/at-people/`
3. Reload Obsidian and enable the plugin in **Settings > Community plugins**

## Important: file naming

By default, person files must start with `@` in their filename:

```
People/
  @John Doe.md
  @Sarah Connor.md
```

The `@` prefix clearly distinguishes person notes from regular notes in your vault.

If your people files don't use `@` (e.g. you already have a folder of contacts named `John Doe.md`), you can disable **Require @ prefix** in settings. The plugin will then treat every `.md` file inside your people folder — including subfolders — as a person.

> **Warning:** with the prefix disabled, make sure your people folder contains only person files. Any `.md` file in it will appear in suggestions.

## Configuration

### People folder

Set the folder where your person files live (e.g. `People/`, `Contacts/`, `Reference/People/`). The plugin scans this folder and all subfolders for person files.

### Explicit links

By default, the plugin inserts simple links:

```
[[@John Doe]]
```

Enable **Explicit links** to include the full path:

```
[[People/@John Doe.md|@John Doe]]
```

### Auto-create files

When enabled, selecting a suggestion automatically creates the person file (and any necessary folders) in your configured people folder. When disabled, the plugin inserts the link but you need to create the file yourself.

> **Tip**: If you use [Templater](https://github.com/SilentVoid13/Templater), you can assign a template to your people folder in Templater's settings (*Folder Templates*). Every new person file created by At People will then be pre-filled with your template automatically.

### Folder mode

Choose how person files are organized:

| Mode | Structure | Example link |
|------|-----------|-------------|
| **Default** | One file per person | `[[People/@John Doe.md\|@John Doe]]` |
| **Per Person** | A folder per person (for related notes) | `[[People/@John Doe/@John Doe.md\|@John Doe]]` |
| **Per Lastname** | Grouped by last name | `[[People/Doe/@John Doe.md\|@John Doe]]` |

Per Person and Per Lastname modes require Explicit links to be enabled.

> **Note on last names**: the plugin takes the last word of the name as the last name. "Charles Le Fabre" becomes "Fabre", not "Le Fabre".

### Include aliases

Disabled by default. When enabled, the plugin reads the `aliases` field from each person file's YAML frontmatter and includes them in the search. For example, if `@María García.md` contains:

```yaml
---
aliases:
  - Mary
  - mamá
---
```

Typing `@Mary` or `@mamá` will suggest **María García**. The suggestion shows the matched alias so you know why it appeared (e.g. `María García (via Mary)`). The inserted link always points to the canonical person name.

### Require @ prefix

Enabled by default. When enabled, only files starting with `@` are recognized as people. When disabled, all `.md` files in the people folder are treated as people. See [file naming](#important-file-naming) for details.

## How ranking works

Results are ranked by combining three factors: how closely the query matches the name (with a slight preference for shorter, more precise matches), how often the person is referenced across your vault, and a light recency boost for recently edited person notes. Frequently mentioned people naturally rise to the top, while still respecting the relevance of your current query.

## Conflicts

Some plugins conflict with the `@` symbol. Check the [known plugin conflicts](https://github.com/backmind/obsidian-at-people/issues?q=is%3Aissue+conflict+) to see if yours is listed.

## Comparison

| | **At People** | **[At Symbol Linking](https://github.com/Ebonsignori/obsidian-at-symbol-linking)** |
|---|---|---|
| Size | ~25 KB | ~145 KB |
| Focus | People only | Multiple entity types |
| Multi-symbol support | `@` only | `@`, `$`, etc. mapped to different folders |
| Alias support | Yes (frontmatter) | Yes |
| Fuzzy search | Accent-insensitive, multi-word, initials | Standard |
| Backlink ranking | Yes | No |
| File templates | No | Yes |

Choose **At People** if you want a fast, focused solution for person linking. Choose **At Symbol Linking** if you need broader symbol-to-folder mapping.

## Contributing

Contributions are welcome. Please open an issue first to discuss major changes.

## Contributors

Originally created by **[saibotsivad](https://github.com/saibotsivad/obsidian-at-people)**, who generously transferred maintenance in October 2025 when the original repository was archived.

- **[saibotsivad](https://github.com/saibotsivad/obsidian-at-people)** — Original author and creator
- **[ph4wks](https://github.com/ph4wks/obsidian-at-people)** — Folder mode variations and auto-file creation
- **[hExPY](https://github.com/hExPY/obsidian-at-people/)** — Additional enhancements
- **[backmind](https://github.com/backmind/obsidian-at-people)** — Current maintainer: fuzzy search, accent-insensitive matching, backlink ranking (v1.1.0+)

## License

Published under the [MIT License](./LICENSE).
