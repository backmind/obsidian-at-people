const { AbstractInputSuggest, EditorSuggest, SuggestModal, Notice, Plugin, PluginSettingTab, Setting } = require('obsidian')

// Default plugin configuration
const DEFAULT_SETTINGS = {
	peopleFolder: 'People/',
	autoCreateFiles: false,
	requireAtPrefix: true,
	useAliases: false,
}

// Regex to extract person name from file path
const NAME_REGEX_AT = /\/@([^\/]+)\.md$/     // With @ prefix: "People/@John Doe.md" -> "John Doe"
const NAME_REGEX_NO_AT = /\/([^\/]+)\.md$/   // Without @ prefix: "People/John Doe.md" -> "John Doe"
// Regex to extract last name (last word after splitting by spaces)
const LAST_NAME_REGEX = /([\S]+)$/

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
		this.registerEvent(this.app.vault.on('delete', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('create', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('rename', async (event, originalFilepath) => { await this.update(event, originalFilepath) }))
		this.registerEvent(this.app.metadataCache.on('changed', (file) => { this.updateAliasesForFile(file) }))
		this.addSettingTab(new AtPeopleSettingTab(this.app, this))
		this.suggestor = new AtPeopleSuggestor(this.app, this)
		this.registerEditorSuggest(this.suggestor)
		
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
					async (personName) => {
						const link = await this.createPersonLink(personName)
						editor.replaceRange(link, from, to)
					}
				).open()
			}
		})
		
		this.app.workspace.onLayoutReady(this.initialize)
	}

	async loadSettings() {
		const storedSettings = await this.loadData()
		this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings)
	}

	async saveSettings() {
		await this.saveData(this.settings || DEFAULT_SETTINGS)
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
	async createPersonLink(display) {
		const lastNameMatch = LAST_NAME_REGEX.exec(display)
		const lastName = lastNameMatch && lastNameMatch[1] ? lastNameMatch[1] : ''
		const atPrefix = this.settings.requireAtPrefix ? '@' : ''
		const filename = `${atPrefix}${display}.md`
		const displayName = this.settings.requireAtPrefix ? `@${display}` : display

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

		// Generate the appropriate link format
		let link
		if (this.settings.useExplicitLinks) {
			link = `[[${filePath}|${displayName}]]`
		}
		else {
			link = `[[${displayName}]]`
		}

		return link
	}
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
    pattern = removeAccents(pattern).toLowerCase();
    text = removeAccents(text).toLowerCase();

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

		const bestByPerson = {}

		// First pass: cheap fuzzy matching against names
		for (let key in (this.peopleFileMap || {})) {
			const score = fuzzyMatch(query, key)
			if (score > 0) {
				bestByPerson[key] = { score, matchedAlias: null }
			}
		}

		// Also match against aliases (still cheap — just fuzzyMatch)
		if (this.settings.useAliases) {
			for (let alias in (this.aliasMap || {})) {
				const canonicalName = this.aliasMap[alias]
				if (!(this.peopleFileMap || {})[canonicalName]) continue
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
			candidate.score += getScoringBoost(this.app, this.peopleFileMap[candidate.name])
		}

		// Re-sort with boost and take final 20
		topCandidates.sort((a, b) => b.score - a.score)
		let suggestions = topCandidates.slice(0, 20).map(s => ({
			type: 'existing',
			name: s.name,
			matchedAlias: s.matchedAlias,
		}))

		suggestions.push({ type: 'create', name: query })
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
		this.onChoose(suggestion.name)
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
	// When the popup closes without a selection (e.g. Escape or click outside),
	// record the trigger position so onTrigger can suppress re-activation.
	close() {
		if (this.context && !this._selectionMade) {
			this.dismissedTrigger = {
				line: this.context.start.line,
				ch: this.context.start.ch,
			}
		}
		this._selectionMade = false
		super.close()
	}

	updatePeopleMap(peopleFileMap, aliasMap) {
		this.peopleFileMap = peopleFileMap
		this.aliasMap = aliasMap
	}
	
	/**
	 * Detect when to trigger the suggester
	 * Triggers when '@' is typed at start of line or after a space
	 */
	onTrigger(cursor, editor, tFile) {
		let charsLeftOfCursor = editor.getLine(cursor.line).substring(0, cursor.ch)
		let atIndex = charsLeftOfCursor.lastIndexOf('@')
		let query = atIndex >= 0 && charsLeftOfCursor.substring(atIndex + 1)
		
		if (
			query
			&& !query.includes(']]')
			&& (atIndex === 0 || charsLeftOfCursor[atIndex - 1] === ' ')
		) {
			// Skip if this '@' was dismissed with Escape
			if (
				this.dismissedTrigger
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

		// Clear dismissed state when cursor moves to a different line
		if (this.dismissedTrigger && this.dismissedTrigger.line !== cursor.line) {
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
		const bestByPerson = {}

		// First pass: cheap fuzzy matching against names
		for (let key in (this.peopleFileMap || {})) {
			const score = fuzzyMatch(context.query, key)
			if (score > 0) {
				bestByPerson[key] = { score, matchedAlias: null }
			}
		}

		// Also match against aliases (still cheap — just fuzzyMatch)
		if (this.plugin.settings.useAliases) {
			for (let alias in (this.aliasMap || {})) {
				const canonicalName = this.aliasMap[alias]
				if (!(this.peopleFileMap || {})[canonicalName]) continue
				const score = fuzzyMatch(context.query, alias)
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
			candidate.score += getScoringBoost(this.app, this.peopleFileMap[candidate.name])
		}

		// Re-sort with boost and take final 20
		topCandidates.sort((a, b) => b.score - a.score)
		let suggestions = topCandidates.slice(0, 20).map(s => ({
			suggestionType: 'set',
			displayText: s.name,
			matchedAlias: s.matchedAlias,
			context,
		}))

		suggestions.push({ suggestionType: 'create', displayText: context.query, context })
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
		const link = await this.plugin.createPersonLink(value.displayText)

		// Replace the '@query' text with the generated link
		value.context.editor.replaceRange(
			link,
			value.context.start,
			value.context.end,
		)
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
		containerEl.createEl('h2', { text: 'At People Settings' })
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
			.setName('Include aliases')
			.setDesc('Match people by their frontmatter aliases (e.g. nicknames). Aliases must be defined in the YAML frontmatter of each person file.')
			.addToggle(
				toggle => toggle
				.setValue(this.plugin.settings.useAliases)
				.onChange(async (value) => {
					this.plugin.settings.useAliases = value
					await this.plugin.saveSettings()
					this.plugin.initialize()
				})
			)
		new Setting(containerEl)
			.setName('Require @ prefix (default: enabled)')
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
	}
}