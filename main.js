const { AbstractInputSuggest, EditorSuggest, SuggestModal, Notice, Plugin, PluginSettingTab, Setting, editorLivePreviewField, editorInfoField } = require('obsidian')
// CodeMirror 6 APIs used to tag person links in Live Preview (the editor view).
// Obsidian bundles these modules, so they resolve at runtime via require().
const { ViewPlugin, Decoration } = require('@codemirror/view')
const { RangeSetBuilder } = require('@codemirror/state')
// tokenClassNodeProp exposes Obsidian's stream-parser token classes (e.g.
// "hmd-internal-link", "link-alias"). Read through this node-type prop they
// come space-separated, which is how Obsidian's own editor code reads them;
// node.type.name carries the same classes joined by underscores.
const { syntaxTree, tokenClassNodeProp } = require('@codemirror/language')

// Default plugin configuration
const DEFAULT_SETTINGS = {
	peopleFolder: 'People/',
	useExplicitLinks: false,
	folderMode: 'DEFAULT', // 'DEFAULT' | 'PER_PERSON' | 'PER_LASTNAME'
	autoCreateFiles: false,
	requireAtPrefix: true,
	addTrailingSpace: false,
	useAliases: false,
	aliasDisplayMode: 'off', // 'off' | 'always' | 'matched'
	enablePillStyle: false,
}

// Regex to extract person name from file path
const NAME_REGEX_AT = /\/@([^\/]+)\.md$/     // With @ prefix: "People/@John Doe.md" -> "John Doe"
const NAME_REGEX_NO_AT = /\/([^\/]+)\.md$/   // Without @ prefix: "People/John Doe.md" -> "John Doe"
// Regex to extract last name (last word after splitting by spaces)
const LAST_NAME_REGEX = /([\S]+)$/

// Endings of the text before the '@' that must NOT start a mention. Everything
// else (whitespace, parentheses, quotes, dashes, punctuation) counts as a word
// boundary, so "(@Jo" or "-@Jo" trigger just like " @Jo" does.
//   \p{L}\p{M}\p{N}_ - keeps emails and handles quiet ("name@host", "José@...",
//                      including NFD text, where the accent is a combining mark)
//   @                - avoids re-triggering on the second '@' of "@@"
//   [                - typing inside a wikilink belongs to Obsidian's own
//                      suggester (and "[@doe2019" is a Pandoc citation)
//   `                - "`@param" is inline code, not a mention
// Anchored and tested against the whole prefix so the last CHARACTER is
// inspected: indexing the string would split surrogate pairs (astral letters)
// into units that \p{L} cannot match.
const MENTION_BLOCKED_PREFIX = /[\p{L}\p{M}\p{N}_@\[`]$/u

// Used only when the "Add a space after the link" setting is on: what may
// directly follow an inserted link without a space between them. Whitespace (so
// the added space never doubles up) plus closers and punctuation, including the
// typographic and CJK forms, that would read as a typo if pushed away from the
// link.
const NO_TRAILING_SPACE_BEFORE = /^[\s)\]}>»"'`’”,.;:!?…、。，：；！？）】」』]/

// Characters a person's name can never contain: they are illegal in a file name
// on at least one platform (\ / : * ? " < >) or they break the [[wikilink]] the
// person is referenced with (# ^ | [ ]). Dropped rather than replaced, so the
// rest of what was typed survives verbatim.
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g

// Stream-parser token classes that mean the '@' is not prose, so no mention
// starts there: fenced or indented code, an inline code span, YAML frontmatter,
// math, and the inside of an existing wikilink. Names taken from Obsidian's own
// editor code, which tests them the same way.
const NON_PROSE_TOKENS = ['hmd-codeblock', 'inline-code', 'hmd-frontmatter', 'math', 'hmd-internal-link']

/**
 * Normalize a raw query into the name of a person to CREATE.
 *
 * Only applies to new people: an existing person's name comes from their file
 * name and must be used as-is, or the generated link would stop resolving.
 *
 * Trimming matters because a query (or a text selection) keeps whatever was
 * typed, and phone keyboards append a space when a word is accepted, so the
 * query often ends with one. Left alone, " John Doe " would create
 * "@ John Doe .md" with a link that resolves to a different name, skip the
 * last-name folder grouping (LAST_NAME_REGEX needs a non-space at the end) and
 * miss the person's aliases. A leading '@' is dropped too, since the prefix is
 * added back when the link is built.
 *
 * Runs of inner whitespace collapse to a single space for the same reason: the
 * suggestion popup renders as HTML, which shows "John  Doe" and "John Doe"
 * identically, so a doubled space would silently produce a second person file
 * that looks like the first one. It also closes the gap an illegal character
 * leaves behind ("Ana : jefa" -> "Ana jefa").
 *
 * @returns {string} the name to create, or '' when nothing usable is left
 */
const normalizeNewPersonName = (query) => (query || '')
	.replace(ILLEGAL_NAME_CHARS, '')
	.replace(/\s+/g, ' ')
	.replace(/^[@\s]+/, '')
	.trim()

// Ensure folder path ends with a trailing slash
const normalizeFolder = (p) => p.endsWith('/') ? p : p + '/'

// Max candidates to compute expensive scoring boost (backlinks + recency) for.
// Fuzzy matching runs on all candidates (cheap), then only the top N get the
// full boost calculation to avoid calling getBacklinksForFile on every person file.
const BOOST_CUTOFF = 30

// Helper to create multi-line descriptions in settings UI
const multiLineDesc = (strings) => {
	const descFragment = document.createDocumentFragment();
	strings.map((string, i, arr) => {
		descFragment.appendChild(document.createTextNode(string));
		if (arr.length - 1 !== i) {
			descFragment.appendChild(document.createElement("br"))
		};
	})
	return descFragment;
}

// Check if a file path represents a person file based on plugin settings
const getPersonName = (filename, settings) => {
	if (!filename.startsWith(settings.peopleFolder) || !filename.endsWith('.md')) return false
	if (settings.requireAtPrefix) {
		return filename.includes('/@') && NAME_REGEX_AT.exec(filename)?.[1]
	}
	// Without @ requirement: any .md in the people folder tree is a person
	// Still strip @ prefix from name if present for consistency
	const match = NAME_REGEX_NO_AT.exec(filename)
	if (!match) return false
	const name = match[1]
	return name.startsWith('@') ? name.slice(1) : name
}

module.exports = class AtPeople extends Plugin {
	async onload() {
		await this.loadSettings()
		this.applyPillStyleClass()
		this.registerEvent(this.app.vault.on('delete', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('create', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('rename', async (event, originalFilepath) => { await this.update(event, originalFilepath) }))
		this.registerEvent(this.app.metadataCache.on('changed', (file) => { this.updateAliasesForFile(file) }))
		this.addSettingTab(new AtPeopleSettingTab(this.app, this))
		this.suggestor = new AtPeopleSuggestor(this.app, this)
		this.registerEditorSuggest(this.suggestor)

		// Tag person links in Reading view so they can be targeted with CSS.
		this.registerMarkdownPostProcessor((el, ctx) => this.markPersonLinks(el, ctx.sourcePath))

		// Tag person links in Live Preview (the CM6 editor view). Internal links
		// there are rendered by CodeMirror and never pass through the markdown
		// post-processor above, so without this they would not get the
		// `at-person` class / `data-at-person` attribute.
		this.registerEditorExtension([buildPersonLinkExtension(this)])

		// Command to convert selected text into a person link
		this.addCommand({
			id: 'link-selection-to-person',
			name: 'Link selected text to person',
			editorCallback: (editor, view) => {
				const selection = editor.getSelection()
				if (!selection) {
					new Notice('No text selected')
					return
				}
				
				const from = editor.getCursor('from')
				const to = editor.getCursor('to')
				
				new PersonSuggestModal(
					this.app,
					this.peopleFileMap,
					this.aliasMap,
					this.settings,
					selection,
					async (personName, matchedAlias) => {
						const link = await this.createPersonLink(personName, matchedAlias)
						editor.replaceRange(link, from, to)
					}
				).open()
			}
		})
		
		this.app.workspace.onLayoutReady(this.initialize)
	}

	onunload() {
		// Remove the body class that gates the optional pill styling.
		document.body.classList.remove('at-people-styled')
	}

	async loadSettings() {
		const storedSettings = await this.loadData()
		this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings)
	}

	async saveSettings() {
		await this.saveData(this.settings || DEFAULT_SETTINGS)
	}

	// Toggle the body class that enables the optional built-in pill styling.
	applyPillStyleClass = () => {
		document.body.classList.toggle('at-people-styled', !!this.settings.enablePillStyle)
	}

	// Reading-view post-processor: add the `at-person` class and a
	// `data-at-person` attribute to every internal link that points at a
	// person file, so the links can be targeted from CSS snippets or themes.
	markPersonLinks = (el, sourcePath) => {
		for (const a of el.querySelectorAll('a.internal-link')) {
			const linkpath = a.getAttribute('data-href') || a.getAttribute('href') || ''
			const name = this.resolvePersonName(linkpath, sourcePath)
			if (name) {
				a.classList.add('at-person')
				a.setAttribute('data-at-person', name)
			}
		}
	}

	// Resolve the person name a link target refers to, or false if it is not a
	// person. Uses the resolved file when it exists, with a path-based fallback
	// so links to not-yet-created person files are still tagged.
	resolvePersonName = (linkpath, sourcePath) => {
		if (!linkpath) return false
		const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath || '')
		if (dest) return getPersonName(dest.path, this.settings)
		// Unresolved link (the person file may not exist yet).
		// Explicit links carry a full path we can match directly.
		const direct = getPersonName(linkpath, this.settings)
		if (direct) return direct
		// Bare links carry only a name; only guess the people-folder path when
		// the '@' prefix is required, otherwise the guess risks false positives.
		if (this.settings.requireAtPrefix) {
			return getPersonName(normalizeFolder(this.settings.peopleFolder) + linkpath + '.md', this.settings)
		}
		return false
	}

	updatePeopleMap = () => {
		this.suggestor.updatePeopleMap(this.peopleFileMap, this.aliasMap)
	}

	// Read aliases from a person file's frontmatter cache
	getAliasesForFile = (filepath) => {
		const file = this.app.vault.getAbstractFileByPath(filepath)
		const aliases = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.aliases
		return Array.isArray(aliases) ? aliases.filter(a => typeof a === 'string') : []
	}

	// Get the first frontmatter alias for a person by canonical name, or null
	firstAliasForName = (name) => {
		const path = (this.peopleFileMap || {})[name]
		if (!path) return null
		const aliases = this.getAliasesForFile(path)
		return aliases.length ? aliases[0] : null
	}

	// Refresh aliases when a file's metadata changes (e.g. frontmatter edited)
	updateAliasesForFile = (file) => {
		if (!this.settings.useAliases) return
		const name = getPersonName(file.path, this.settings)
		if (!name) return
		// Remove old aliases for this person
		for (const [alias, canonical] of Object.entries(this.aliasMap || {})) {
			if (canonical === name) delete this.aliasMap[alias]
		}
		// Add current aliases
		for (const alias of this.getAliasesForFile(file.path)) {
			this.aliasMap[alias] = name
		}
		this.updatePeopleMap()
	}

	// Update the people map when files are created, deleted, or renamed
	update = async ({ path, deleted }, originalFilepath) => {
		this.peopleFileMap = this.peopleFileMap || {}
		this.aliasMap = this.aliasMap || {}
		const name = getPersonName(path, this.settings)
		let needsUpdated
		if (name) {
			if (deleted) {
				delete this.peopleFileMap[name]
				// Remove aliases for deleted person
				for (const [alias, canonical] of Object.entries(this.aliasMap)) {
					if (canonical === name) delete this.aliasMap[alias]
				}
			} else {
				this.peopleFileMap[name] = path
				// Refresh aliases for new/changed person file
				if (this.settings.useAliases) {
					for (const alias of this.getAliasesForFile(path)) {
						this.aliasMap[alias] = name
					}
				}
			}
			needsUpdated = true
		}
		originalFilepath = originalFilepath && getPersonName(originalFilepath, this.settings)
		if (originalFilepath) {
			delete this.peopleFileMap[originalFilepath]
			// Remove aliases for renamed-away person
			for (const [alias, canonical] of Object.entries(this.aliasMap)) {
				if (canonical === originalFilepath) delete this.aliasMap[alias]
			}
			needsUpdated = true
		}
		if (needsUpdated) this.updatePeopleMap()
	}

	// Initialize the people map by scanning all files in the vault
	initialize = () => {
		this.peopleFileMap = {}
		this.aliasMap = {}
		for (const filename in this.app.vault.fileMap) {
			const name = getPersonName(filename, this.settings)
			if (name) {
				this.peopleFileMap[name] = filename
				if (this.settings.useAliases) {
					for (const alias of this.getAliasesForFile(filename)) {
						this.aliasMap[alias] = name
					}
				}
			}
		}
		window.setTimeout(() => {
			this.updatePeopleMap()
		})
	}
	
	// Shared logic to create links to people
	// Handles different folder modes (default, per-person, per-lastname)
	async createPersonLink(display, matchedAlias = null) {
		const lastNameMatch = LAST_NAME_REGEX.exec(display)
		const lastName = lastNameMatch && lastNameMatch[1] ? lastNameMatch[1] : ''
		const atPrefix = this.settings.requireAtPrefix ? '@' : ''
		const filename = `${atPrefix}${display}.md`
		const displayName = this.settings.requireAtPrefix ? `@${display}` : display

		// Optionally use a frontmatter alias as the visible link text.
		// The link target always stays the canonical link; only the display changes.
		//   'always'  - use an alias whenever the person has one (the matched
		//               alias, otherwise the first frontmatter alias).
		//   'matched' - use the alias only when the search actually matched one;
		//               if matched by name, keep the name.
		//   'off'     - never; always use the file-name-derived display.
		let aliasText = null
		// Alias display is a sub-feature of "Include aliases": it only applies
		// when alias matching is enabled.
		const aliasMode = this.settings.useAliases ? this.settings.aliasDisplayMode : 'off'
		if (aliasMode === 'always') {
			aliasText = matchedAlias || this.firstAliasForName(display) || null
		} else if (aliasMode === 'matched') {
			aliasText = matchedAlias || null
		}

		// Determine target folder and file path based on folder mode
		let targetFolder = normalizeFolder(this.settings.peopleFolder)
		let filePath = targetFolder + filename

		if (this.settings.folderMode === "PER_PERSON") {
			targetFolder = normalizeFolder(this.settings.peopleFolder) + `${atPrefix}${display}/`
			filePath = targetFolder + filename
		} else if (this.settings.folderMode === "PER_LASTNAME") {
			targetFolder = normalizeFolder(this.settings.peopleFolder) + (lastName ? lastName + '/' : '')
			filePath = targetFolder + filename
		}

		// Auto-create folders and files if enabled
		if (this.settings.autoCreateFiles) {
			const folderToCreate = targetFolder.replace(/\/$/, '')
			try { await this.app.vault.createFolder(folderToCreate) } catch (e) { /* exists */ }
			try { await this.app.vault.create(filePath, '') } catch (e) { /* exists */ }
		}

		// Generate the appropriate link format.
		// When an alias display text is available, always emit a piped link so the
		// target is preserved while the visible text becomes the alias.
		let link
		if (this.settings.useExplicitLinks) {
			link = aliasText ? `[[${filePath}|${aliasText}]]` : `[[${filePath}|${displayName}]]`
		}
		else if (aliasText) {
			link = `[[${displayName}|${aliasText}]]`
		}
		else {
			link = `[[${displayName}]]`
		}

		return link
	}
}

/**
 * Build the CodeMirror 6 editor extension that adds the `at-person` class and a
 * `data-at-person` attribute to internal links pointing at person files while in
 * Live Preview. This mirrors the Reading-view post-processor (markPersonLinks) so
 * both views share the SAME person-detection rules (resolvePersonName).
 *
 * The extension is a ViewPlugin that builds mark Decorations over the visible
 * ranges only (cheap) and rebuilds them on document, viewport, and selection
 * changes. It closes over the plugin instance so it can reuse resolvePersonName.
 *
 * Detection walks the editor syntax tree (not a text regex) and operates on the
 * `hmd-internal-link` tokens directly. Those tokens cover only the inner link
 * text, never the `[[`/`]]` brackets (which are separate "formatting-link"
 * tokens), so the target/alias text is read straight from each token's range.
 * The pattern follows the Supercharged Links plugin's live-preview decorator.
 *
 * Source path is read from `editorInfoField` so bare/relative links resolve the
 * same way they do in Reading view. Embeds (`![[...]]`) are not special-cased,
 * so a person embed's inner text is also tagged (Reading view does not tag
 * embeds); this is a rare, cosmetic-only difference.
 */
function buildPersonLinkExtension(plugin) {
	// Resolve the note that owns this editor so link resolution matches the
	// Reading-view post-processor (relative/bare links can depend on it).
	const sourcePathFor = (view) => {
		try {
			const info = view.state.field(editorInfoField, false)
			return (info && info.file && info.file.path) || ''
		} catch (e) {
			return ''
		}
	}

	return ViewPlugin.fromClass(
		class {
			constructor(view) {
				this.decorations = this.buildDecorations(view)
			}

			update(update) {
				// Rebuild on text, viewport, or selection changes (Obsidian swaps a
				// link between its rendered form and raw source as the cursor moves).
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = this.buildDecorations(update.view)
				}
			}

			buildDecorations(view) {
				const builder = new RangeSetBuilder()
				// Only decorate in Live Preview, never in plain source mode.
				if (!view.state.field(editorLivePreviewField, false)) {
					return builder.finish()
				}
				const sourcePath = sourcePathFor(view)
				const tree = syntaxTree(view.state)
				// Person name carried from an internal-link target to its alias token.
				let pendingPerson = null

				for (const { from, to } of view.visibleRanges) {
					tree.iterate({
						from,
						to,
						enter: (node) => {
							// Obsidian joins a node's stream-parser token classes with
							// underscores in the type name, e.g.
							// "hmd-internal-link_link-alias_strong". Split them back out
							// to test individual classes. The `[[`/`]]` brackets are
							// separate "formatting-link" tokens with no
							// "hmd-internal-link" class, so they are skipped here (this
							// is why a bracket-based regex over the token range fails —
							// the token covers only the inner text).
							const classes = new Set(node.type.name.split('_'))
							if (!classes.has('hmd-internal-link')) return
							if (classes.has('link-alias-pipe')) return // the "|" separator

							if (classes.has('link-alias')) {
								// The visible alias in [[target|Alias]]. Tag it when its
								// target resolved to a person.
								if (pendingPerson) {
									builder.add(node.from, node.to, Decoration.mark({
										class: 'at-person',
										attributes: { 'data-at-person': String(pendingPerson) },
									}))
								}
								pendingPerson = null
								return
							}

							// Otherwise this token is the link target text. Resolve the
							// person it points at, sharing the Reading-view rules.
							let linkText = view.state.doc.sliceString(node.from, node.to)
							linkText = linkText.split('#')[0].split('^')[0].trim()
							const personName = plugin.resolvePersonName(linkText, sourcePath)
							pendingPerson = personName || null
							// When the link has an alias the target text is hidden and the
							// alias token (handled above) carries the visible text, so only
							// tag the target itself when there is no alias.
							if (personName && !classes.has('link-has-alias')) {
								builder.add(node.from, node.to, Decoration.mark({
									class: 'at-person',
									attributes: { 'data-at-person': String(personName) },
								}))
							}
						},
					})
				}
				return builder.finish()
			}
		},
		{
			decorations: (instance) => instance.decorations,
		},
	)
}

/**
 * Remove accents/diacritics from a string for accent-insensitive matching
 * Example: "José García" -> "Jose Garcia"
 */
function removeAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Fuzzy matching algorithm with length-based penalty
 * Returns a score based on how well the pattern matches the text
 * Higher scores indicate better matches
 * 
 * Scoring hierarchy:
 * - Exact match at name start: 3000 × length_factor
 * - Match at word boundary: 2500 × length_factor  
 * - Multi-word pattern match: 1500 × length_factor
 * - Word initials match: 1000 × length_factor
 * - Word start match: 800 × length_factor
 * 
 * Length factor: penalizes texts longer than the pattern
 * Formula: (pattern_length / text_length) ^ 0.5
 * Square root softens the penalty so backlink boosts have more relative weight
 */
function fuzzyMatch(pattern, text) {
    // Trim surrounding whitespace on both sides: in the query a leading/trailing
    // space (e.g. added by a phone keyboard) is never meaningful and would break
    // the substring match, and in the name it would demote a person whose file
    // was created with a stray space from "start of name" to "word boundary" and
    // inflate the length penalty. Scoring only: the name itself is untouched.
    // Always-on behavior, not configurable.
    pattern = removeAccents(pattern).toLowerCase().trim();
    text = removeAccents(text).toLowerCase().trim();

    // Similarity factor: penalizes texts longer than the pattern
    // Range: 0.0 to 1.0, where 1.0 is perfect length match
    const getSimilarityFactor = () => {
        const lenRatio = Math.min(pattern.length / text.length, 1.0);
        // Square root scale for softer proportional penalty
        return Math.pow(lenRatio, 0.5);
    };

    // Check for substring match (highest priority)
    const substringIndex = text.indexOf(pattern);
    if (substringIndex !== -1) {
        let substringScore = 2000;
        if (substringIndex === 0) {
            // Pattern matches at the very start of the name (best case)
            substringScore += 1000;
        } else if (text[substringIndex - 1] === ' ') {
            // Pattern matches at a word boundary
            substringScore += 500;
        }
        // Apply length penalty to favor shorter matches
        return substringScore * getSimilarityFactor();
    }

    // Check for multi-word pattern match
    // Example: "juan car" matches "Juan Carlos"
    const patternWords = pattern.split(' ').filter(w => w.length > 0);
    if (patternWords.length > 1) {
        const textWords = text.split(' ');
        let matchedWords = 0;
        let usedIndices = new Set();

        for (let pWord of patternWords) {
            let found = false;
            for (let i = 0; i < textWords.length; i++) {
                if (!usedIndices.has(i) && textWords[i].startsWith(pWord)) {
                    matchedWords++;
                    usedIndices.add(i);
                    found = true;
                    break;
                }
            }
            if (!found) break;
        }

        if (matchedWords === patternWords.length) {
            return 1500 * getSimilarityFactor();
        }
    }

    // Check for initials match
    // Example: "jc" matches "Juan Carlos"
    const words = text.split(' ');
    if (words.length > 1 && pattern.length <= words.length) {
        let patternIdx = 0;
        let wordIdx = 0;

        while (patternIdx < pattern.length && wordIdx < words.length) {
            if (words[wordIdx].length > 0 && words[wordIdx][0] === pattern[patternIdx]) {
                patternIdx++;
            }
            wordIdx++;
        }

        if (patternIdx === pattern.length) {
            return 1000 * getSimilarityFactor();
        }
    }

    // Check for word-start match
    // Example: "mar" matches "Juan Martinez"
    for (let word of words) {
        if (word.startsWith(pattern)) {
            return 800 * getSimilarityFactor();
        }
    }

    // No match found
    return -Infinity;
}

/**
 * Calculate scoring boost from backlinks and recency
 *
 * Backlink boost: logarithmic scale × 1000
 * - 1 backlink: ~693 pts, 10: ~2398, 50: ~3932, 100: ~4615
 *
 * Recency boost: exponential decay, max ~200 pts
 * - Today: ~200, 1 week: ~158, 1 month: ~72, 3 months: ~0
 * Light tiebreaker — never overrides fuzzy match or backlinks
 *
 * @param {Object} app - Obsidian app instance
 * @param {string} filepath - Path to the person file
 * @returns {number} Boost score to add to pattern matching score
 */
function getScoringBoost(app, filepath) {
    const file = app.vault.getAbstractFileByPath(filepath);
    if (!file) return 0;

    // Backlink boost: high multiplier so frequently-referenced people overcome length penalties
    let backlinkBoost = 0;
    const backlinks = app.metadataCache.getBacklinksForFile(file);
    if (backlinks?.data) {
        const count = backlinks.data.size;
        backlinkBoost = count > 0 ? Math.log(count + 1) * 1000 : 0;
    }

    // Recency boost: exponential decay based on file modification time
    const daysAgo = (Date.now() - file.stat.mtime) / 86400000;
    const recencyBoost = Math.max(0, 200 * Math.exp(-daysAgo / 30));

    return backlinkBoost + recencyBoost;
}

/**
 * Rank person candidates for a query and return the best matches.
 *
 * Two-pass approach shared by the editor suggester and the command modal so
 * both rank identically: cheap fuzzy matching over every name (and over aliases
 * when enabled), then the expensive backlink + recency boost on only the top
 * BOOST_CUTOFF candidates. Returns at most 20 entries as { name, matchedAlias }.
 *
 * @returns {Array<{name: string, matchedAlias: string|null}>}
 */
function rankPeople(app, query, peopleFileMap, aliasMap, useAliases) {
	const bestByPerson = {}

	// First pass: cheap fuzzy matching against names
	for (let key in (peopleFileMap || {})) {
		const score = fuzzyMatch(query, key)
		if (score > 0) {
			bestByPerson[key] = { score, matchedAlias: null }
		}
	}

	// Also match against aliases (still cheap — just fuzzyMatch)
	if (useAliases) {
		for (let alias in (aliasMap || {})) {
			const canonicalName = aliasMap[alias]
			if (!(peopleFileMap || {})[canonicalName]) continue
			const score = fuzzyMatch(query, alias)
			if (score > 0 && (!bestByPerson[canonicalName] || score > bestByPerson[canonicalName].score)) {
				bestByPerson[canonicalName] = { score, matchedAlias: alias }
			}
		}
	}

	// Sort by fuzzy score, take top N for expensive boost calculation
	let fuzzyResults = Object.entries(bestByPerson).map(([name, data]) => ({ name, ...data }))
	fuzzyResults.sort((a, b) => b.score - a.score)
	const topCandidates = fuzzyResults.slice(0, BOOST_CUTOFF)

	// Second pass: add scoring boost (backlinks + recency) only for top candidates
	for (const candidate of topCandidates) {
		candidate.score += getScoringBoost(app, peopleFileMap[candidate.name])
	}

	// Re-sort with boost and take final 20
	topCandidates.sort((a, b) => b.score - a.score)
	return topCandidates.slice(0, 20).map(s => ({ name: s.name, matchedAlias: s.matchedAlias }))
}

/**
 * Modal to select a person from selected text
 * Allows converting highlighted text into a person link
 */
class PersonSuggestModal extends SuggestModal {
	constructor(app, peopleFileMap, aliasMap, settings, initialQuery, onChoose) {
		super(app)
		this.peopleFileMap = peopleFileMap
		this.aliasMap = aliasMap
		this.settings = settings
		this.initialQuery = initialQuery
		this.onChoose = onChoose
		this.setPlaceholder('Select person or create new')
	}
	
	onOpen() {
		super.onOpen()
		// Pre-populate with the selected text
		this.inputEl.value = this.initialQuery
		this.inputEl.select()

		// Register Tab key to select the currently highlighted suggestion
		this.scope.register([], "Tab", (evt) => {
			// Check if there's a selected item in the suggestions
			if (this.chooser && this.chooser.selectedItem >= 0 && this.chooser.values) {
				const selectedSuggestion = this.chooser.values[this.chooser.selectedItem]
				this.onChooseSuggestion(selectedSuggestion)
				this.close()
				return false // Prevent default Tab behavior
			}
			return true // Allow default Tab if no suggestion selected
		})
	}
	
	getSuggestions(query) {
		if (!query) query = this.initialQuery

		const suggestions = rankPeople(this.app, query, this.peopleFileMap, this.aliasMap, this.settings.useAliases)
			.map(s => ({ type: 'existing', name: s.name, matchedAlias: s.matchedAlias }))

		// The selection is raw text, so it can carry stray spaces, a leading '@'
		// or characters no file name accepts. Offer to create only what is left
		// after cleaning it up, and nothing at all when that is empty.
		const newName = normalizeNewPersonName(query)
		if (newName) suggestions.push({ type: 'create', name: newName })
		return suggestions
	}

	renderSuggestion(suggestion, el) {
		if (suggestion.type === 'create') {
			el.createEl('div', { text: 'New person: ' + suggestion.name })
		} else if (suggestion.matchedAlias) {
			el.createEl('div', { text: suggestion.name + ' (via ' + suggestion.matchedAlias + ')' })
		} else {
			el.createEl('div', { text: suggestion.name })
		}
	}
	
	onChooseSuggestion(suggestion) {
		this.onChoose(suggestion.name, suggestion.matchedAlias)
	}
}

/**
 * EditorSuggest for normal typing flow
 * Triggers when user types '@' followed by text
 */
class AtPeopleSuggestor extends EditorSuggest {
	constructor(app, plugin) {
		super(app)
		this.plugin = plugin
		this.settings = plugin.settings
		this.dismissedTrigger = null

		// Register Tab key to select the currently highlighted suggestion
		this.scope.register([], "Tab", (evt) => {
			// Check if suggestions popup is open and has a selected item
			if (this.suggestions && this.suggestions.values && this.suggestions.selectedItem >= 0) {
				const selectedValue = this.suggestions.values[this.suggestions.selectedItem]
				this.selectSuggestion(selectedValue)
				return false // Prevent default Tab behavior
			}
			return true // Allow default Tab if no suggestions are shown
		})

	}

	// Override close to track dismissed '@' position.
	// Obsidian closes the popup for several reasons and only a real dismissal
	// (Escape, click outside) may veto the '@'. The other two must not, or the
	// column would stay vetoed for the rest of the line:
	//   - getSuggestions returned nothing: Obsidian's showSuggestions() closes
	//     the popup itself, with the context still set.
	//   - the click that closes the popup happens before the cursor move is
	//     processed (Obsidian debounces it), so the context is stale.
	close() {
		if (this.context && !this._selectionMade && !this.lastListWasEmpty && this.isMentionUnderCursor()) {
			this.dismissedTrigger = {
				// Coordinates alone would suppress the same spot in every other
				// note, so the veto is scoped to the file it happened in.
				path: (this.context.file && this.context.file.path) || '',
				line: this.context.start.line,
				ch: this.context.start.ch,
			}
		}
		this._selectionMade = false
		super.close()
	}

	// True when the mention the popup was opened for is still the one the cursor
	// sits in, i.e. the popup is closing while it could just as well stay open.
	isMentionUnderCursor() {
		try {
			const editor = this.context.editor
			const cursor = editor.getCursor()
			if (!cursor || cursor.line !== this.context.start.line) return false
			const mention = this.findMention(cursor, editor)
			return !!mention && mention.atIndex === this.context.start.ch
		} catch (e) {
			// Missing editor or a cursor outside the document: treat it as gone.
			return false
		}
	}

	updatePeopleMap(peopleFileMap, aliasMap) {
		this.peopleFileMap = peopleFileMap
		this.aliasMap = aliasMap
	}
	
	/**
	 * Find the mention the cursor is currently typing, regardless of whether it
	 * was dismissed. A mention is an '@' at a word boundary (start of line, or
	 * after any character that is not part of a word, see MENTION_BLOCKED_PREFIX,
	 * so an '@' glued to punctuation such as "(@Jo" counts) followed by a query
	 * that has not run past the end of a link.
	 *
	 * @returns {{atIndex: number, query: string}|null}
	 */
	findMention(cursor, editor) {
		const charsLeftOfCursor = editor.getLine(cursor.line).substring(0, cursor.ch)
		const atIndex = charsLeftOfCursor.lastIndexOf('@')
		if (atIndex < 0) return null
		const query = charsLeftOfCursor.substring(atIndex + 1)
		// The '@' belongs glued to the name, so a space right after it means the
		// '@' is being used as a word ("Cena @ 21:00") and no mention starts. A
		// space further along is part of the name ("@Juan Perez"), and so is a
		// trailing one, which is what a phone keyboard appends when it accepts a
		// word.
		if (!/^\S/.test(query) || query.includes(']]')) return null
		if (atIndex > 0 && MENTION_BLOCKED_PREFIX.test(charsLeftOfCursor.slice(0, atIndex))) return null
		return { atIndex, query }
	}

	/**
	 * Whether a mention may start at this position, that is, the position is
	 * prose and not code, frontmatter, math or an existing wikilink.
	 *
	 * Obsidian exposes a node's stream-parser classes as a space-separated
	 * string through tokenClassNodeProp, and reads them the same way internally
	 * (`new Set(prop.split(' ')).has('hmd-codeblock')`). Inside a fenced block
	 * with language highlighting the token carries both, e.g.
	 * "hmd-codeblock keyword", hence the class-by-class test. The node name is
	 * used as a fallback, where the same classes come joined by underscores.
	 *
	 * Fails OPEN on anything unexpected (no CM6 view, no tree, an API that
	 * moved): a failed tree read must never silence the suggester.
	 */
	isProseAt(pos, editor) {
		try {
			const view = editor.cm
			if (!view || !editor.posToOffset) return true
			const tree = syntaxTree(view.state)
			if (!tree || !tree.resolveInner) return true
			for (let node = tree.resolveInner(editor.posToOffset(pos), 1); node; node = node.parent) {
				const raw = node.type.prop(tokenClassNodeProp) || node.type.name || ''
				if (raw.split(/[\s_]+/).some(c => NON_PROSE_TOKENS.includes(c))) return false
			}
			return true
		} catch (e) {
			return true
		}
	}

	/**
	 * Detect when to trigger the suggester
	 */
	onTrigger(cursor, editor, tFile) {
		const mention = this.findMention(cursor, editor)
		const filePath = (tFile && tFile.path) || ''

		// The '@' anchors the mention, so that is the position that decides
		// whether this is prose: the cursor may already have moved past a
		// closing backtick while the '@' sits inside the code span.
		if (mention && this.isProseAt({ line: cursor.line, ch: mention.atIndex }, editor)) {
			const { atIndex, query } = mention
			// Skip if this '@' was dismissed with Escape
			if (
				this.dismissedTrigger
				&& this.dismissedTrigger.path === filePath
				&& this.dismissedTrigger.line === cursor.line
				&& this.dismissedTrigger.ch === atIndex
			) {
				return null
			}
			// New '@' detected, clear dismissed state
			this.dismissedTrigger = null

			return {
				start: { line: cursor.line, ch: atIndex },
				end: { line: cursor.line, ch: cursor.ch },
				query,
			}
		}

		// Clear dismissed state once the cursor is somewhere the veto cannot
		// apply any more: another file, or another line of the same one.
		if (
			this.dismissedTrigger
			&& (this.dismissedTrigger.path !== filePath || this.dismissedTrigger.line !== cursor.line)
		) {
			this.dismissedTrigger = null
		}

		return null
	}
	
	/**
	 * Get suggestions based on the current query
	 * Two-pass approach: cheap fuzzy matching first, then expensive scoring boost
	 * only for top candidates. This avoids calling getBacklinksForFile on every
	 * person file on every keystroke.
	 */
	getSuggestions(context) {
		const suggestions = rankPeople(this.app, context.query, this.peopleFileMap, this.aliasMap, this.plugin.settings.useAliases)
			.map(s => ({ suggestionType: 'set', displayText: s.name, matchedAlias: s.matchedAlias, context }))

		// Create the cleaned-up name, not the raw query: it still holds whatever
		// was typed, including the space phone keyboards append when accepting a
		// word. The entry shows the exact name that will be created.
		const newName = normalizeNewPersonName(context.query)
		if (newName) suggestions.push({ suggestionType: 'create', displayText: newName, context })

		// Obsidian closes the popup on its own when this comes back empty (no
		// match and no name to create, e.g. "@///"). close() needs to know that
		// it was not the user dismissing anything.
		this.lastListWasEmpty = suggestions.length === 0
		return suggestions
	}

	renderSuggestion(value, elem) {
		if (value.suggestionType === 'create') elem.setText('New person: ' + value.displayText)
		else if (value.matchedAlias) elem.setText(value.displayText + ' (via ' + value.matchedAlias + ')')
		else elem.setText(value.displayText)
	}
	
	/**
	 * Handle selection of a suggestion
	 * Delegates link creation to the plugin's shared createPersonLink method
	 */
	async selectSuggestion(value) {
		this._selectionMade = true
		this.dismissedTrigger = null
		const link = await this.plugin.createPersonLink(value.displayText, value.matchedAlias)
		const { editor, start, end } = value.context

		// Optionally leave the cursor ready for the next word by appending a
		// space, unless the text right after the insertion point already starts
		// with one (or with punctuation that must stay glued to the link).
		const textAfter = editor.getLine(end.line).slice(end.ch)
		const trailingSpace = this.plugin.settings.addTrailingSpace && !NO_TRAILING_SPACE_BEFORE.test(textAfter)
			? ' '
			: ''

		// Replace the '@query' text with the generated link
		editor.replaceRange(link + trailingSpace, start, end)
	}
}

/**
 * Folder autocomplete for settings input
 * Shows existing vault folders as suggestions while typing
 */
class FolderSuggest extends AbstractInputSuggest {
	constructor(app, inputEl, onChangeCb) {
		super(app, inputEl)
		this.textInputEl = inputEl
		this.onChangeCb = onChangeCb
	}

	getSuggestions(inputStr) {
		const inputLower = inputStr.toLowerCase()
		const folders = this.app.vault.getAllFolders().map(f => f.path + '/')
		return folders.filter(folder => folder.toLowerCase().includes(inputLower))
	}

	renderSuggestion(folder, el) {
		el.createEl('div', { text: folder })
	}

	selectSuggestion(folder, evt) {
		this.textInputEl.value = folder
		this.close()
		this.onChangeCb(folder)
	}
}

/**
 * Settings tab for the At-People plugin
 * Allows configuration of people folder, link format, folder modes, and auto-creation
 */
class AtPeopleSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin)
		this.plugin = plugin
	}
	display() {
		const { containerEl } = this
		containerEl.empty()
		new Setting(containerEl).setName('Files & folders').setHeading()
		new Setting(containerEl)
			.setName('People folder')
			.setDesc('The folder where people files live.')
			.addSearch(search => {
				const handleChange = async (value) => {
					this.plugin.settings.peopleFolder = value
					await this.plugin.saveSettings()
					this.plugin.initialize()
				}
				search
					.setPlaceholder(DEFAULT_SETTINGS.peopleFolder)
					.setValue(this.plugin.settings.peopleFolder)
					.onChange(handleChange)
				new FolderSuggest(this.app, search.inputEl, handleChange)
				search.inputEl.blur()
			})
		new Setting(containerEl)
			.setName('Folder mode')
			.setDesc(multiLineDesc([
			"Default: People/@John Doe.md",
			"Per Person: People/@John Doe/@John Doe.md",
			"Per Lastname: People/Doe/@John Doe.md",
			"Paths reflect the \"Require @ prefix\" setting.",
			"",
			"Non-default modes require \"Explicit links\"."
			]))
			.addDropdown(
				dropdown => {
					dropdown.addOption("DEFAULT", "Default");
					dropdown.addOption("PER_PERSON", "Per person");
					dropdown.addOption("PER_LASTNAME", "Per lastname");
					dropdown.setValue(this.plugin.settings.folderMode)
					dropdown.onChange(async (value) => {
						this.plugin.settings.folderMode = value
						await this.plugin.saveSettings()
						this.plugin.initialize()
					})
				}
			)
		new Setting(containerEl)
			.setName('Auto-create files')
			.setDesc('Automatically create person files and folders when selecting a person suggestion')
			.addToggle(
				toggle => toggle
				.setValue(this.plugin.settings.autoCreateFiles)
				.onChange(async (value) => {
					this.plugin.settings.autoCreateFiles = value
					await this.plugin.saveSettings()
				})
			)
		new Setting(containerEl)
			.setName('Require @ prefix')
			.setDesc(multiLineDesc([
			"When enabled, only files starting with @ are recognized as people (e.g. @John Doe.md).",
			"When disabled, all .md files in the people folder are treated as people.",
			"",
			"Warning: if disabled, make sure your people folder only contains person files."
			]))
			.addToggle(
				toggle => toggle
				.setValue(this.plugin.settings.requireAtPrefix)
				.onChange(async (value) => {
					this.plugin.settings.requireAtPrefix = value
					await this.plugin.saveSettings()
					this.plugin.initialize()
				})
			)

		new Setting(containerEl).setName('Links').setHeading()
		new Setting(containerEl)
			.setName('Explicit links')
			.setDesc('When inserting links include the full path, e.g. [[People/@John Doe.md|@John Doe]]')
			.addToggle(
				toggle => toggle
				.setValue(this.plugin.settings.useExplicitLinks)
				.onChange(async (value) => {
					this.plugin.settings.useExplicitLinks = value
					await this.plugin.saveSettings()
					this.plugin.initialize()
				})
			)
		new Setting(containerEl)
			.setName('Add a space after the link')
			.setDesc(multiLineDesc([
			"Leave a space after an inserted link so you can keep typing straight away. Handy on phones.",
			"",
			"The space is skipped when the text after the link already starts with a space or with a closing symbol such as ) or , but a mark you type afterwards will be pushed away from the link: \"Talked to @John.\" ends up as \"Talked to [[@John Doe]] .\""
			]))
			.addToggle(
				toggle => toggle
				.setValue(this.plugin.settings.addTrailingSpace)
				.onChange(async (value) => {
					this.plugin.settings.addTrailingSpace = value
					await this.plugin.saveSettings()
				})
			)

		new Setting(containerEl).setName('Aliases').setHeading()
		new Setting(containerEl)
			.setName('Include aliases')
			.setDesc('Match people by their frontmatter aliases (e.g. nicknames). Aliases must be defined in the YAML frontmatter of each person file.')
			.addToggle(
				toggle => toggle
				.setValue(this.plugin.settings.useAliases)
				.onChange(async (value) => {
					this.plugin.settings.useAliases = value
					await this.plugin.saveSettings()
					this.plugin.initialize()
					// Re-render so "Use alias as display text" below reflects its
					// enabled/disabled state immediately (it depends on this toggle).
					this.display()
				})
			)
		// Build a richer description: a short intro, then one bold-labelled line
		// per option, so the choices stand out instead of reading as prose.
		const aliasDesc = document.createDocumentFragment()
		const aliasLine = (...parts) => {
			if (aliasDesc.childNodes.length) aliasDesc.appendChild(document.createElement('br'))
			for (const part of parts) {
				aliasDesc.appendChild(typeof part === 'string' ? document.createTextNode(part) : part)
			}
		}
		const aliasOption = (label) => {
			const strong = document.createElement('strong')
			strong.textContent = label
			return strong
		}
		aliasLine("Use a person's alias as the visible link text. If @john-doe has the alias \"Uncle John\", the link then shows as Uncle John while still pointing to the file.")
		aliasLine('')
		aliasLine(aliasOption('Off'), ': always show the file name.')
		aliasLine(aliasOption('Always prefer alias'), ': show the alias whenever the person has one.')
		aliasLine(aliasOption('Only when matched by alias'), ': show the alias only if you searched by it; searching by the file name keeps the file name.')
		aliasLine('')
		aliasLine('Needs "Include aliases" above. A person with no alias always shows the file name.')
		const aliasDisplaySetting = new Setting(containerEl)
			.setName('Use alias as display text')
			.setDesc(aliasDesc)
			.addDropdown(
				dropdown => {
					dropdown.addOption('off', 'Off')
					dropdown.addOption('always', 'Always prefer alias')
					dropdown.addOption('matched', 'Only when matched by alias')
					dropdown.setValue(this.plugin.settings.aliasDisplayMode)
					dropdown.setDisabled(!this.plugin.settings.useAliases)
					dropdown.onChange(async (value) => {
						this.plugin.settings.aliasDisplayMode = value
						await this.plugin.saveSettings()
						this.plugin.initialize()
					})
				}
			)
		// Grey out the whole row when alias matching is off so the dependency on
		// "Include aliases" is visible, not just implied.
		aliasDisplaySetting.setDisabled(!this.plugin.settings.useAliases)

		new Setting(containerEl).setName('Appearance').setHeading()
		new Setting(containerEl)
			.setName('Style person links as pills')
			.setDesc(multiLineDesc([
			"Show @person links as tag-style pills in Reading view and Live Preview, using your theme's tag colors.",
			"",
			"Person links always get the 'at-person' class and a 'data-at-person' attribute, so you can write your own CSS even with this off."
			]))
			.addToggle(
				toggle => toggle
				.setValue(this.plugin.settings.enablePillStyle)
				.onChange(async (value) => {
					this.plugin.settings.enablePillStyle = value
					await this.plugin.saveSettings()
					this.plugin.applyPillStyleClass()
				})
			)

		new Setting(containerEl)
			.setName('Reset to defaults')
			.setDesc('Restore every setting above to its default value.')
			.addButton(button => {
				let confirming = false
				button
					.setButtonText('Reset to defaults')
					.onClick(async () => {
						// Two-click guard: the first click arms the reset, the second
						// (within a few seconds) performs it, to avoid accidents.
						if (!confirming) {
							confirming = true
							button.setButtonText('Click again to confirm').setWarning()
							window.setTimeout(() => { if (confirming) this.display() }, 4000)
							return
						}
						this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS)
						await this.plugin.saveSettings()
						this.plugin.applyPillStyleClass()
						this.plugin.initialize()
						new Notice('At People settings reset to defaults')
						this.display()
					})
			})
	}
}