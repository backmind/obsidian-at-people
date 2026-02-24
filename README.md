# At People

[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22at-people%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=at-people)
[![Version](https://img.shields.io/github/manifest-json/v/backmind/obsidian-at-people?color=%23483699&logo=obsidian)](https://github.com/backmind/obsidian-at-people/releases)
[![License](https://img.shields.io/github/license/backmind/obsidian-at-people)](./LICENSE.md)
[![Install in Obsidian](https://img.shields.io/badge/Install%20in%20Obsidian-%23483699?logo=obsidian)](obsidian://show-plugin?id=at-people)

A lightweight Obsidian plugin that lets you mention people with `@`, just like you would in a chat or social media. Type `@` followed by a name, pick from the suggestions, and a wiki-link is inserted automatically.

![](./example.png)

## Features

- **Smart fuzzy search** — finds people even with partial input, typos in word order, or accent differences
  - `"john"` matches **John Doe**
  - `"jose"` matches **José García**
  - `"jd"` matches **John Doe** (initials)
  - `"doe jo"` matches **John Doe** (multi-word)
- **Backlink-based ranking** — people you reference often appear higher in suggestions
- **Link selected text** — select any text, run the command **"At-People: Link selected text to person"** from the palette, and convert it into a person link instantly. Assign a hotkey (e.g. `Ctrl+Shift+A`) for even faster linking.
- **Dismiss with Escape** — press `Esc` to dismiss suggestions; they won't reappear until you type a new `@`
- **Auto-create files** — optionally create person files and folders on the fly when selecting a suggestion
- **Flexible folder modes** — store people as flat files, per-person folders, or grouped by last name

## Installation

### From Community Plugins

1. Open **Settings > Community plugins**
2. Search for **"At People"**
3. Click **Install**, then **Enable**

### Manual

1. Download the latest release from [Releases](https://github.com/backmind/obsidian-at-people/releases)
2. Extract to `<vault>/.obsidian/plugins/at-people/`
3. Reload Obsidian and enable the plugin in **Settings > Community plugins**

## Important: file naming

Person files **must** start with `@` in their filename. For example:

```
People/
  @John Doe.md
  @Sarah Connor.md
```

Without the `@` prefix, the plugin won't recognize a file as a person. This is by design — it clearly distinguishes person notes from regular notes in your vault.

## Configuration

### People folder

Set the folder where your person files live (e.g. `People/`, `Contacts/`, `Reference/People/`). The plugin scans this folder for files starting with `@`.

### Link format

By default, the plugin inserts simple links:

```
[[@John Doe]]
```

Enable **Explicit links** to include the full path:

```
[[People/@John Doe.md|@John Doe]]
```

### Folder mode

Choose how person files are organized:

| Mode | Structure | Example link |
|------|-----------|-------------|
| **Default** | One file per person | `[[People/@John Doe.md\|@John Doe]]` |
| **Per Person** | A folder per person (for related notes) | `[[People/@John Doe/@John Doe.md\|@John Doe]]` |
| **Per Lastname** | Grouped by last name | `[[People/Doe/@John Doe.md\|@John Doe]]` |

Per Person and Per Lastname modes require Explicit links to be enabled.

> **Note on last names**: the plugin takes the last word of the name as the last name. "Charles Le Fabre" becomes "Fabre", not "Le Fabre".

### Auto-create files

When enabled, selecting a suggestion automatically creates the person file (and any necessary folders) in your configured people folder. When disabled, the plugin inserts the link but you need to create the file yourself.

## How ranking works

Results are ranked by combining two factors: how closely the query matches the name (with a slight preference for shorter, more precise matches) and how often the person is referenced across your vault. Frequently mentioned people naturally rise to the top, while still respecting the relevance of your current query.

## Conflicts

Some plugins conflict with the `@` symbol. Check the [known plugin conflicts](https://github.com/backmind/obsidian-at-people/issues?q=is%3Aissue+conflict+) to see if yours is listed.

## Comparison

| | **At People** | **[At Symbol Linking](https://github.com/Ebonsignori/obsidian-at-symbol-linking)** |
|---|---|---|
| Size | ~20 KB | ~145 KB |
| Focus | People only | Multiple entity types |
| Multi-symbol support | `@` only | `@`, `$`, etc. mapped to different folders |
| Alias support | No | Yes |
| Fuzzy search | Accent-insensitive, multi-word, initials | Standard |
| Backlink ranking | Yes | No |
| File templates | No | Yes |

Choose **At People** if you want a fast, focused solution for person linking. Choose **At Symbol Linking** if you need broader symbol-to-folder mapping or alias support.

## Contributing

Contributions are welcome. Please open an issue first to discuss major changes.

## Contributors

Originally created by **[saibotsivad](https://github.com/saibotsivad/obsidian-at-people)**, who generously transferred maintenance in October 2025 when the original repository was archived.

- **[saibotsivad](https://github.com/saibotsivad/obsidian-at-people)** — Original author and creator
- **[ph4wks](https://github.com/ph4wks/obsidian-at-people)** — Folder mode variations and auto-file creation
- **[hExPY](https://github.com/hExPY/obsidian-at-people/)** — Additional enhancements
- **[backmind](https://github.com/backmind/obsidian-at-people)** — Current maintainer: fuzzy search, accent-insensitive matching, backlink ranking (v1.1.0+)

## License

Published under the [Very Open License](http://veryopenlicense.com/).
