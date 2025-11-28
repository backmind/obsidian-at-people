# At People

Obsidian plugin to add that familiar @-to-tag-someone syntax:

![](./example.png)

When you hit enter on a suggestion, it'll create a link that looks like this:

```

The author was [[@Rich Hickey]]

```

and leave the cursor at the end.

> **Maintenance Transfer**: This is now the actively maintained version of the At-People plugin, with permission from the original creator [Tobias Davis (saibotsivad)](https://github.com/saibotsivad). The [original repository](https://github.com/saibotsivad/obsidian-at-people) has been archived as of October 2025. We're grateful to Tobias for creating this plugin and for entrusting the community with its continued development.

## Installation

### From Obsidian Community Plugins
1. Open Settings → Community plugins
2. Search for "At-People"
3. Click Install, then Enable

### Manual Installation
1. Download latest release from [Releases](https://github.com/backmind/obsidian-at-people/releases)
2. Extract to `<vault>/.obsidian/plugins/at-people/`
3. Reload Obsidian
4. Enable plugin in Settings → Community plugins

## 🎉 New Features

### Link Selected Text (New!)
You can now select any text in your editor and quickly convert it into a person link using a search modal.

1.  Select a piece of text (e.g., "Rich Hickey").
2.  Run the command from the palette: **"At-People: Link selected text to person"**.
3.  A search modal will appear, allowing you to find an existing person or create a new one.
4.  On selection, the text will be replaced with the formatted link (e.g., `[[@Rich Hickey]]`).

> **Pro-tip**: You can assign a hotkey to this command, such as `Ctrl+Shift+A`, from the Obsidian `Settings → Hotkeys` menu for even faster linking.

## Search Features

This plugin includes intelligent fuzzy search with the following capabilities:

- **Accent-insensitive**: Search for "martin" and find "Martín García"
- **Case-insensitive**: "JOHN" matches "John Doe"
- **Substring matching**: "rich" matches "Rich Hickey" or "Rich Harris"
- **Multi-word search**: "juan car" matches "Juan Carlos"
- **Initials matching**: "jc" matches "Juan Carlos"
- **Word-start matching**: "mar" matches "Juan Martinez"
- **Smart ranking**: Results are prioritized by:
  - Exact matches at name start (highest priority)
  - Matches at word boundaries
  - Number of backlinks (frequently referenced people rank higher)

**Note**: The search only returns contiguous matches. Searching "lun" will NOT match "Laura Undurry Navaez" (non-contiguous letters).

## Configuration Options

The plugin offers several configuration options to customize behavior:

### 1. Where are the people files?

You probably want to group the people files in a folder.

I usually do something like this:

```

People/
@Rich Hickey.md
@Rich Harris.md

```

You can configure that in settings to point to somewhere else, like `Reference/People/` or whatever makes sense.

### 2. Explicit link structure?

By default, the plugin will insert the simple version:

```

[[@Rich Hickey]]

```

But you might rather make that explicit, in which case you can enable "explicit links" and they'll look like this instead:

```

[[People/@Rich Hickey.md|@Rich Hickey]]

```

### 3. Folder Mode

You can store the people in three different ways using the dropdown.

#### Default

This setting is the default. It creates a single file per person.

Example:

```

People/
@Rich Hickey.md
@Rich Harris.md

```

And then the inserted link would look like:

```

[[People/@Rich Hickey.md|@Rich Hickey]]
or if explicit link is disabled
[[@Rich Hickey]]

```

#### Per Person

This setting will create a directory per person. You can use it to store multiple notes related to the same person. It requires "Explicit link" to be enabled.

Example:

```

People/
@Rich Hickey/
@Rich Hickey.md
more-files.md
@Rich Harris/
@Rich Harris.md
more-files.md

```

And then the inserted link would look like:

```

[[People/@Rich Hickey/@Rich Hickey.md|@Rich Hickey]]

```

#### Per Lastname

This setting will create a directory per lastname and a single file for the person itself. You can e.g. use it if you have many people sharing the same lastname. It requires "Explicit link" to be enabled.

Example:

```

People/
Hickey/
@Rich Hickey.md
Harris/
@Rich Harris.md

```

And then the inserted link would look like:

```

[[People/Hickey/@Rich Hickey.md|@Rich Hickey]]

```

> Note: figuring out what the "last name" is (or if it even has one) is really complicated! This plugin takes a very simple approach: if you split a name by the space character, it'll just pick the last "word". So for example "Charles Le Fabre" would be "Fabre" and *not* "Le Fabre".
>
> I'm open to better implementations that don't add a lot of complexity, just start a discussion.

### 4. Auto-create files

When enabled, the plugin will automatically create person files and the necessary folders when you select a person suggestion. This works seamlessly with all folder modes:

- **Default mode**: Creates the file directly in the People folder
- **Per Person mode**: Creates a folder for the person and the file inside it
- **Per Lastname mode**: Creates a folder for the lastname and the file inside it

If this setting is disabled (default), you need to manually create the person files yourself.

## Technical Features

### Performance
- Results are limited to top 20 suggestions to maintain responsiveness
- Backlink counts are only calculated for matching results (not all people)
- Efficient in-memory caching of person files

### Smart Ranking Algorithm (Updated!)
The plugin uses a sophisticated scoring system that combines:
- **Pattern matching score** (800-3000 base points):
  - Exact match at name start: 3000 pts
  - Match at word boundary: 2500 pts
  - Multi-word pattern match: 1500 pts
  - Word initials match: 1000 pts
  - Word start match: 800 pts
- **Length Penalty (New)**: All pattern scores are multiplied by a `similarityFactor` (`pattern_length / text_length`). This heavily penalizes matches that are much longer than the query, ensuring that "John" ranks higher than "Johnathan" when searching for "John".
- **Backlink boost** (Now much more powerful):
  - Logarithmic scale (with a `* 1000` multiplier) based on reference frequency.
  - 1 backlink ≈ 693 pts
  - 10 backlinks ≈ 2397 pts
  - 100 backlinks ≈ 4615 pts

This ensures that frequently-used people appear higher in suggestions while maintaining high relevance to your search query.

## Conflicts

Several plugins have conflicts with using the `@` symbol, please look at the [Github issues for plugin conflicts](https://github.com/backmind/obsidian-at-people/issues?q=is%3Aissue+conflict+) to see if yours has been resolved.

## Contributing

Contributions welcome. Open an issue first to discuss major changes.

## Contributors

This plugin is built upon the work of multiple contributors:

- **[saibotsivad](https://github.com/saibotsivad/obsidian-at-people)** - Original plugin author and creator
- **[ph4wks](https://github.com/ph4wks/obsidian-at-people)** - Folder mode variations and auto-file creation features
- **[hExPY](https://github.com/hExPY/obsidian-at-people/)** - Additional enhancements and improvements
- **[backmind](https://github.com/backmind/obsidian-at-people)** - Current maintainer; fuzzy search, accent-insensitive matching, and backlink-based ranking (v1.1.0+)

## License

Published and made available freely under the [Very Open License](http://veryopenlicense.com/).