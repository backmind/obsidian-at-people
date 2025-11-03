const { App, Editor, EditorSuggest, SuggestModal, TFile, Notice, Plugin, PluginSettingTab, Setting } = require('obsidian')

// Default plugin configuration
const DEFAULT_SETTINGS = {
	peopleFolder: 'People/',
	autoCreateFiles: false,
}

// Regex to extract person name from file path (e.g., "People/@John Doe.md" -> "John Doe")
const NAME_REGEX = /\/@([^\/]+)\.md$/
// Regex to extract last name (last word after splitting by spaces)
const LAST_NAME_REGEX = /([\S]+)$/

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
const getPersonName = (filename, settings) => filename.startsWith(settings.peopleFolder)
	&& filename.endsWith('.md')
	&& filename.includes('/@')
	&& NAME_REGEX.exec(filename)?.[1]

module.exports = class AtPeople extends Plugin {
	async onload() {
		await this.loadSettings()
		this.registerEvent(this.app.vault.on('delete', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('create', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('rename', async (event, originalFilepath) => { await this.update(event, originalFilepath) }))
		this.addSettingTab(new AtPeopleSettingTab(this.app, this))
		this.suggestor = new AtPeopleSuggestor(this.app, this.settings)
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
		this.settings = await Object.assign({}, DEFAULT_SETTINGS, storedSettings)
	}

	async saveSettings() {
		await this.saveData(this.settings || DEFAULT_SETTINGS)
	}

	updatePeopleMap = () => {
		this.suggestor.updatePeopleMap(this.peopleFileMap)
	}

	// Update the people map when files are created, deleted, or renamed
	update = async ({ path, deleted, ...remaining }, originalFilepath) => {
		this.peopleFileMap = this.peopleFileMap || {}
		const name = getPersonName(path, this.settings)
		let needsUpdated
		if (name) {
			this.peopleFileMap[name] = path
			needsUpdated = true
		}
		originalFilepath = originalFilepath && getPersonName(originalFilepath, this.settings)
		if (originalFilepath) {
			delete this.peopleFileMap[originalFilepath]
			needsUpdated = true
		}
		if (needsUpdated) this.updatePeopleMap()
	}

	// Initialize the people map by scanning all files in the vault
	initialize = () => {
		this.peopleFileMap = {}
		for (const filename in this.app.vault.fileMap) {
			const name = getPersonName(filename, this.settings)
			if (name) this.peopleFileMap[name] = filename
		}
		window.setTimeout(() => {
			this.updatePeopleMap()
		})
	}
	
	// Shared logic to create links to people
	// Handles different folder modes (default, per-person, per-lastname)
	async createPersonLink(display) {
		const normalizeFolder = (p) => p.endsWith('/') ? p : p + '/'
		const lastNameMatch = LAST_NAME_REGEX.exec(display)
		const lastName = lastNameMatch && lastNameMatch[1] ? lastNameMatch[1] : ''
		const filename = `@${display}.md`

		// Determine target folder and file path based on folder mode
		let targetFolder = normalizeFolder(this.settings.peopleFolder)
		let filePath = targetFolder + filename

		if (this.settings.folderMode === "PER_PERSON") {
			// Creates: People/@John Doe/@John Doe.md
			targetFolder = normalizeFolder(this.settings.peopleFolder) + `@${display}/`
			filePath = targetFolder + filename
		} else if (this.settings.folderMode === "PER_LASTNAME") {
			// Creates: People/Doe/@John Doe.md
			targetFolder = normalizeFolder(this.settings.peopleFolder) + (lastName ? lastName + '/' : '')
			filePath = targetFolder + filename
		}

		// Auto-create folders and files if enabled
		if (this.settings.autoCreateFiles) {
			const folderToCreate = targetFolder.replace(/\/$/, '')
			if (!this.app.vault.getAbstractFileByPath(folderToCreate)) {
				try {
					await this.app.vault.createFolder(folderToCreate)
				} catch (e) {
					console.warn('Could not create folder', folderToCreate, e)
				}
			}

			if (!this.app.vault.getAbstractFileByPath(filePath)) {
				try {
					await this.app.vault.create(filePath, '')
				} catch (e) {
					console.warn('Could not create file', filePath, e)
				}
			}
		}

		// Generate the appropriate link format
		let link
		if (this.settings.folderMode === "PER_PERSON" && this.settings.useExplicitLinks) {
			link = `[[${filePath}|@${display}]]`
		}
		else if (this.settings.useExplicitLinks && this.settings.folderMode === "PER_LASTNAME") {
			link = `[[${filePath}|@${display}]]`
		}
		else if (this.settings.useExplicitLinks) {
			link = `[[${filePath}|@${display}]]`
		}
		else {
			link = `[[@${display}]]`
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
 * Formula: (pattern_length / text_length) ^ 1.0
 * This ensures shorter, more precise matches rank higher
 */
function fuzzyMatch(pattern, text) {
    pattern = removeAccents(pattern).toLowerCase();
    text = removeAccents(text).toLowerCase();

    // Similarity factor: penalizes texts longer than the pattern
    // Range: 0.0 to 1.0, where 1.0 is perfect length match
    const getSimilarityFactor = () => {
        const lenRatio = Math.min(pattern.length / text.length, 1.0);
        // Linear scale for proportional penalty
        return Math.pow(lenRatio, 1.0);
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
 * Calculate boost score based on backlink count
 * Uses logarithmic scale to prevent excessive dominance while still rewarding popularity
 * Multiplier of 1000 allows heavily-referenced people to rank higher
 * 
 * Example scores:
 * - 1 backlink: ~173 pts
 * - 10 backlinks: ~600 pts
 * - 50 backlinks: ~985 pts
 * - 100 backlinks: ~1152 pts
 * - 160 backlinks: ~5081 pts (with multiplier 1000)
 * 
 * @param {Object} app - Obsidian app instance
 * @param {string} filepath - Path to the person file
 * @returns {number} Boost score to add to pattern matching score
 */
function getBacklinkBoost(app, filepath) {
    const file = app.vault.getAbstractFileByPath(filepath);
    if (!file) return 0;
	let backlinkCount = 0;
	const backlinks = app.metadataCache.getBacklinksForFile(file);
        if (backlinks?.data) {
                backlinkCount = backlinks.data.size;
		}
    // High multiplier (1000) so frequently-referenced people can overcome length penalties
    return backlinkCount > 0 ? Math.log(backlinkCount + 1) * 1000 : 0;
}

/**
 * Modal to select a person from selected text
 * Allows converting highlighted text into a person link
 */
class PersonSuggestModal extends SuggestModal {
	constructor(app, peopleFileMap, settings, initialQuery, onChoose) {
		super(app)
		this.peopleFileMap = peopleFileMap
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
	}
	
	getSuggestions(query) {
		if (!query) query = this.initialQuery
		
		// Score all existing people
		let scoredSuggestions = []
		for (let key in (this.peopleFileMap || {})) {
			const score = fuzzyMatch(query, key)
			if (score > 0) {
				const backlinkBoost = getBacklinkBoost(this.app, this.peopleFileMap[key])
				scoredSuggestions.push({
					score: score + backlinkBoost,
					type: 'existing',
					name: key,
				})
			}
		}

		// Sort by score and limit to top 20
		scoredSuggestions.sort((a, b) => b.score - a.score)
		let suggestions = scoredSuggestions.slice(0, 20)
		
		// Always include option to create new person
		suggestions.push({
			type: 'create',
			name: query,
		})
		
		return suggestions
	}
	
	renderSuggestion(suggestion, el) {
		if (suggestion.type === 'create') {
			el.createEl('div', { text: 'New person: ' + suggestion.name })
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
	constructor(app, settings) {
		super(app)
		this.settings = settings
	}
	
	folderModePerPerson = () => this.settings.folderMode === "PER_PERSON"
	folderModePerLastname = () => this.settings.folderMode === "PER_LASTNAME"
	
	updatePeopleMap(peopleFileMap) {
		this.peopleFileMap = peopleFileMap
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
			return {
				start: { line: cursor.line, ch: atIndex },
				end: { line: cursor.line, ch: cursor.ch },
				query,
			}
		}
		
		return null
	}
	
	/**
	 * Get suggestions based on the current query
	 * Combines pattern matching score with backlink boost
	 * Returns top 20 results plus option to create new person
	 */
	getSuggestions(context) {
		let scoredSuggestions = []
		for (let key in (this.peopleFileMap || {})) {
			const score = fuzzyMatch(context.query, key)
			if (score > 0) {
				const backlinkBoost = getBacklinkBoost(this.app, this.peopleFileMap[key])
				scoredSuggestions.push({
					score: score + backlinkBoost,
					suggestionType: 'set',
					displayText: key,
					context,
				})
			}
		}

		scoredSuggestions.sort((a, b) => b.score - a.score)
		let suggestions = scoredSuggestions.slice(0, 20).map(s => ({
			suggestionType: s.suggestionType,
			displayText: s.displayText,
			context: s.context,
		}))

		suggestions.push({
			suggestionType: 'create',
			displayText: context.query,
			context,
		})
		
		return suggestions
	}
	
	renderSuggestion(value, elem) {
		if (value.suggestionType === 'create') elem.setText('New person: ' + value.displayText)
		else elem.setText(value.displayText)
	}
	
	/**
	 * Handle selection of a suggestion
	 * Creates the appropriate link format based on settings
	 * Auto-creates files and folders if enabled
	 */
	async selectSuggestion(value) {
		const display = value.displayText
		const normalizeFolder = (p) => p.endsWith('/') ? p : p + '/'
		const lastNameMatch = LAST_NAME_REGEX.exec(display)
		const lastName = lastNameMatch && lastNameMatch[1] ? lastNameMatch[1] : ''
		const filename = `@${display}.md`

		// Determine target folder and file path based on folder mode
		let targetFolder = normalizeFolder(this.settings.peopleFolder)
		let filePath = targetFolder + filename

		if (this.folderModePerPerson()) {
			// Creates: People/@John Doe/@John Doe.md
			targetFolder = normalizeFolder(this.settings.peopleFolder) + `@${display}/`
			filePath = targetFolder + filename
		} else if (this.folderModePerLastname()) {
			// Creates: People/Doe/@John Doe.md
			targetFolder = normalizeFolder(this.settings.peopleFolder) + (lastName ? lastName + '/' : '')
			filePath = targetFolder + filename
		}

		// Auto-create folders and files if enabled
		if (this.settings.autoCreateFiles) {
			const folderToCreate = targetFolder.replace(/\/$/, '')
			if (!this.app.vault.getAbstractFileByPath(folderToCreate)) {
				try {
					await this.app.vault.createFolder(folderToCreate)
				} catch (e) {
					console.warn('Could not create folder', folderToCreate, e)
				}
			}

			if (!this.app.vault.getAbstractFileByPath(filePath)) {
				try {
					await this.app.vault.create(filePath, '')
				} catch (e) {
					console.warn('Could not create file', filePath, e)
				}
			}
		}

		// Generate the appropriate link format
		let link
		if (this.folderModePerPerson() && this.settings.useExplicitLinks) {
			link = `[[${filePath}|@${display}]]`
		}
		else if (this.settings.useExplicitLinks && this.folderModePerLastname()) {
			link = `[[${filePath}|@${display}]]`
		}
		else if (this.settings.useExplicitLinks && !this.folderModePerLastname()) {
			link = `[[${filePath}|@${display}]]`
		}
		else {
			link = `[[@${display}]]`
		}

		// Replace the '@query' text with the generated link
		value.context.editor.replaceRange(
			link,
			value.context.start,
			value.context.end,
		)
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
		new Setting(containerEl)
			.setName('People folder')
			.setDesc('The folder where people files live, e.g. "People/". (With trailing slash.)')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.peopleFolder)
					.setValue(this.plugin.settings.peopleFolder)
					.onChange(async (value) => {
						this.plugin.settings.peopleFolder = value
						await this.plugin.saveSettings()
						this.plugin.initialize()
					})
			)
		new Setting(containerEl)
			.setName('Explicit links')
			.setDesc('When inserting links include the full path, e.g. [[People/@Bob Dole.md|@Bob Dole]]')
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
			.setName('Folder Mode')
			.setDesc(multiLineDesc([
			"Default - Creates a file for every person in the path defined in \"People folder\" e.g. [[People/@Bob Dole|@Bob Dole]]",
			"",
			"Everything non-default requires \"Explicit links\" to be enabled!",
			"Per Person - Creates a folder (and a note with the same name) for every person in the path defined in \"People folder\" e.g. [[People/@Bob Dole/@Bob Dole|@Bob Dole]]",
			"Per Lastname - Creates a folder with the Lastname of the person in the path defined in \"People folder\" e.g. [[People/Dole/@Bob Dole|@Bob Dole]]"
			]))
			.addDropdown(
				dropdown => {
					dropdown.addOption("DEFAULT", "Default");
					dropdown.addOption("PER_PERSON", "Per Person");
					dropdown.addOption("PER_LASTNAME", "Per Lastname");
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
	}
}