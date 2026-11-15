# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tags carry the bare version, with no `v` prefix, because Obsidian's plugin updater matches the tag against `manifest.json`.

Entries up to 1.8.1 were reconstructed from the release notes and the git history.

## [Unreleased]

## [1.8.2] - 2026-11-15

### Changed

- Mention suggestions are much lighter in large vaults. The backlink counts used for ranking now come from the link index Obsidian already keeps, instead of a walk through every link in the vault for each candidate on each keystroke. In a test vault with 5,700 notes, 25,000 links and 230 people, one keystroke went from about 770,000 link lookups to none, and from 30 ms to 0.3 ms on desktop. The order of the suggestions is unchanged.
- Person links cost less while editing. Live Preview checked every visible link again on each keystroke, cursor move and scroll, and the answers are now reused until a file is created, renamed or deleted.
- The "People folder" setting says that an empty value means the whole vault, and the README explains how to cover several people folders through their common parent. ([#17])

### Fixed

- An empty people folder now covers the whole vault. People at the vault root were skipped, and new people got a path starting with `/`. ([#17])
- Existing people are linked where their file is. With people in subfolders, picking one of them could point an explicit link at a file that did not exist and, with "Auto-create files" on, leave an empty duplicate at the top of the people folder.
- Pills from the built-in style no longer overlap the lines above and below when the text font is tall.

## [1.8.1] - 2026-08-23

### Fixed

- Mentions no longer open inside code. Typing `@name` in a code block, an inline code span, YAML frontmatter, math or a half-typed `[[wikilink` is left alone.
- Dismissing with `Esc` is now per note. It used to suppress the same line and column in every other note.

## [1.8.0] - 2026-08-23

### Added

- The `@` triggers next to punctuation, such as `(@jo`, `"@jo`, `-@jo` or after a tab. Emails, inline code and an `@` used as a word stay quiet.
- "Add a space after the link" setting, off by default.
- Regression test suite (`npm test`) covering the trigger rules, name normalization and the dismissal behavior.

### Changed

- Names of new people are cleaned up: surrounding and repeated spaces, characters that no file name accepts or that would break the wikilink, and a leading `@` are removed. Existing people are always linked by their real file name.
- README configuration section reordered to match the settings tab.

### Fixed

- Dismissing suggestions with Escape no longer blocks that `@` for good when the popup had closed on its own.
- People whose file name carries a stray space rank correctly in search.

## [1.7.0] - 2026-06-30

### Added

- Person links are styled in Live Preview as well as Reading view: the `at-person` class, the `data-at-person` attribute and the optional pill style. ([#13])
- "Use alias as display text" setting, with three modes: off, always, or only when the search matched the alias. ([#14])
- "Reset to defaults" button in the settings tab.

### Changed

- Settings tab grouped into sections: Files & folders, Links, Aliases, Appearance.
- The `@` search ignores a leading or trailing space.

## [1.6.0] - 2026-06-02

### Added

- Person links in Reading view get the `at-person` CSS class and a `data-at-person` attribute, so they can be styled from a snippet or theme. ([#10])
- "Style person links as pills" setting, off by default, using the theme's tag colors.

## [1.5.1] - 2026-03-05

### Fixed

- `LICENSE.md` renamed to `LICENSE` and the author field in `manifest.json` cleaned up. ([#9])

## [1.5.0] - 2026-02-24

### Added

- Frontmatter alias support, opt-in: people can be matched by the aliases in their YAML frontmatter, and the suggestion shows which alias matched.
- Recency boost: recently edited person notes get a light bump in the ranking.
- "Require @ prefix" setting, to accept person files without the `@`. ([#6])
- Folder autocomplete in the settings.
- Pressing `Esc` dismisses the suggestions without them reopening on the same `@`.

### Changed

- Ranking scores every candidate with the fuzzy match first and looks up backlinks only for the top 30.
- Softer length penalty in the ranking (square root of the length ratio).
- License changed to MIT.
- README rewritten: features, aliases, ranking and a comparison table. ([#8])

## [1.2.4] - 2025-12-12

### Changed

- README: comparison with At Symbol Linking. ([#5])

## [1.2.3] - 2025-12-11

### Changed

- `authorUrl` in `manifest.json` points to the GitHub profile. ([#3])

## [1.2.2] - 2025-11-28

### Changed

- UI labels use sentence case and the README header was renamed, both to follow Obsidian's plugin guidelines. ([#3])

## [1.2.1] - 2025-11-06

### Added

- `Tab` selects the highlighted suggestion, alongside `Enter`.

## [1.2.0] - 2025-11-03

### Added

- "Link selected text to person" command: turn a selection into a person link through a search modal.

### Changed

- Backlinks weigh ten times more in the ranking.
- Matches much longer than the query are penalized, which favors precise results.

## [1.1.0] - 2025-10-27

First release under the current maintainer, after the original repository was archived. It brings together the work of [ph4wks](https://github.com/ph4wks/obsidian-at-people) (folder modes, auto-create) and [hExPY](https://github.com/hExPY/obsidian-at-people/).

### Added

- Fuzzy search: accent-insensitive, case-insensitive, with multi-word, initials and word-start matching.
- Ranking by backlinks: people referenced more often rank higher.
- Folder modes: flat files, a folder per person, or grouped by last name.
- "Auto-create files" setting, off by default.

### Changed

- Suggestions are limited to the 20 best matches.

## 1.0.2 - 2023-08-20

Released by the original author, [saibotsivad](https://github.com/saibotsivad/obsidian-at-people). The 1.0.x versions have no tag in this repository.

### Fixed

- Emails and similar text no longer open the suggester.

## 1.0.1 - 2023-08-19

### Fixed

- Timing issue in the suggester.

## 1.0.0 - 2023-08-16

### Added

- Initial release: type `@` to get suggestions from the people folder and insert a link to the person.

[Unreleased]: https://github.com/backmind/obsidian-at-people/compare/1.8.2...HEAD
[1.8.2]: https://github.com/backmind/obsidian-at-people/compare/1.8.1...1.8.2
[1.8.1]: https://github.com/backmind/obsidian-at-people/compare/1.8.0...1.8.1
[1.8.0]: https://github.com/backmind/obsidian-at-people/compare/1.7.0...1.8.0
[1.7.0]: https://github.com/backmind/obsidian-at-people/compare/1.6.0...1.7.0
[1.6.0]: https://github.com/backmind/obsidian-at-people/compare/1.5.1...1.6.0
[1.5.1]: https://github.com/backmind/obsidian-at-people/compare/1.5.0...1.5.1
[1.5.0]: https://github.com/backmind/obsidian-at-people/compare/1.2.4...1.5.0
[1.2.4]: https://github.com/backmind/obsidian-at-people/compare/1.2.3...1.2.4
[1.2.3]: https://github.com/backmind/obsidian-at-people/compare/1.2.2...1.2.3
[1.2.2]: https://github.com/backmind/obsidian-at-people/compare/1.2.1...1.2.2
[1.2.1]: https://github.com/backmind/obsidian-at-people/compare/v1.2.0...1.2.1
[1.2.0]: https://github.com/backmind/obsidian-at-people/compare/1.1.0...v1.2.0
[1.1.0]: https://github.com/backmind/obsidian-at-people/releases/tag/1.1.0
[#3]: https://github.com/backmind/obsidian-at-people/issues/3
[#5]: https://github.com/backmind/obsidian-at-people/issues/5
[#6]: https://github.com/backmind/obsidian-at-people/issues/6
[#8]: https://github.com/backmind/obsidian-at-people/issues/8
[#9]: https://github.com/backmind/obsidian-at-people/pull/9
[#10]: https://github.com/backmind/obsidian-at-people/issues/10
[#13]: https://github.com/backmind/obsidian-at-people/issues/13
[#14]: https://github.com/backmind/obsidian-at-people/issues/14
[#17]: https://github.com/backmind/obsidian-at-people/issues/17
