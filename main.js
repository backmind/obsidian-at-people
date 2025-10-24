const { App, Editor, EditorSuggest, TFile, Notice, Plugin, PluginSettingTab, Setting } = require('obsidian')

const DEFAULT_SETTINGS = {
	peopleFolder: 'People/',
	autoCreateFiles: false,
	// Defaults:
	// peopleFolder: undefined
	// folderMode: undefined
	// useExplicitLinks: undefined
}

const NAME_REGEX = /\/@([^\/]+)\.md$/
const LAST_NAME_REGEX = /([\S]+)$/

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
}

function removeAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function fuzzyMatch(pattern, text) {
    pattern = removeAccents(pattern).toLowerCase();
    text = removeAccents(text).toLowerCase();

    // --- Strict Substring Check ---
    // If the pattern is a direct substring, give it a very high score.
    const substringIndex = text.indexOf(pattern);
    if (substringIndex !== -1) {
        // Prioritize exact matches at the beginning of the string
        // or at the beginning of a word.
        let substringScore = 2000; // Base for direct substring
        if (substringIndex === 0) {
            substringScore += 1000; // Huge bonus for starting the string
        } else if (text[substringIndex - 1] === ' ') {
            substringScore += 500; // Big bonus for starting a word
        }
        return substringScore;
    }

    // --- Multi-word Pattern Match ---
    // Check if pattern words match text words/substrings
    // e.g., "juan car" matches "Juan Carlos"
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
            return 1500; // High score for multi-word match
        }
    }

    // --- Word Initials Match ---
    // Check if pattern matches the initials of words
    // e.g., "jc" matches "Juan Carlos"
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
            // All pattern characters matched word initials
            return 1000; // Good score for initials match
        }
    }

    // --- Partial Word Match ---
    // Check if pattern is a substring of any word start
    // e.g., "mar" matches "Juan Martinez" (starts with "Mar")
    for (let word of words) {
        if (word.startsWith(pattern)) {
            return 800; // Good score but lower than full substring
        }
    }

    return -Infinity; // No match
}

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
	onTrigger(cursor, editor, tFile) {
		let charsLeftOfCursor = editor.getLine(cursor.line).substring(0, cursor.ch)
		let atIndex = charsLeftOfCursor.lastIndexOf('@')
		let query = atIndex >= 0 && charsLeftOfCursor.substring(atIndex + 1)
		if (
			query
			&& !query.includes(']]')
			&& (
				// if it's an @ at the start of a line
				atIndex === 0
				// or if there's a space character before it
				|| charsLeftOfCursor[atIndex - 1] === ' '
			)
		) {
			return {
				start: { line: cursor.line, ch: atIndex },
				end: { line: cursor.line, ch: cursor.ch },
				query,
			}
		}
		return null
	}
	getBacklinkBoost(filepath) {
		const file = this.app.vault.getAbstractFileByPath(filepath);
		if (!file) return 0;

		const backlinks = this.app.metadataCache.getBacklinksForFile(file);
		if (!backlinks) return 0;

		// backlinks.data is an object with files that link to this person
		const backlinkCount = Object.keys(backlinks.data || {}).length;

		// Logarithmic boost: 1 link=0pts, 10 links=~230pts, 100 links=~460pts
		return backlinkCount > 0 ? Math.log(backlinkCount + 1) * 100 : 0;
	}
	getSuggestions(context) {
		let scoredSuggestions = []
		for (let key in (this.peopleFileMap || {})) {
			const score = fuzzyMatch(context.query, key);
			if (score > 0) { // Only include matches with positive scores
				const backlinkBoost = this.getBacklinkBoost(this.peopleFileMap[key]);
				scoredSuggestions.push({
					score: score + backlinkBoost,
					suggestionType: 'set',
					displayText: key,
					context,
				})
			}
		}

		scoredSuggestions.sort((a, b) => b.score - a.score); // Sort by score, higher is better

		// Limit to top 20 suggestions
		let suggestions = scoredSuggestions.slice(0, 20).map(s => ({
			suggestionType: s.suggestionType,
			displayText: s.displayText,
			context: s.context,
		}));

		suggestions.push({
			suggestionType: 'create',
			displayText: context.query,
			context,
		});
		return suggestions
	}
	renderSuggestion(value, elem) {
		if (value.suggestionType === 'create') elem.setText('New person: ' + value.displayText)
		else elem.setText(value.displayText)
	}
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
			targetFolder = normalizeFolder(this.settings.peopleFolder) + `@${display}/`
			filePath = targetFolder + filename
		} else if (this.folderModePerLastname()) {
			targetFolder = normalizeFolder(this.settings.peopleFolder) + (lastName ? lastName + '/' : '')
			filePath = targetFolder + filename
		}

		// Auto-create folder and file if setting is enabled
		if (this.settings.autoCreateFiles) {
			// Ensure folder exists
			const folderToCreate = targetFolder.replace(/\/$/, '')
			if (!this.app.vault.getAbstractFileByPath(folderToCreate)) {
				try {
					await this.app.vault.createFolder(folderToCreate)
				} catch (e) {
					console.warn('Could not create folder', folderToCreate, e)
				}
			}

			// Ensure file exists
			if (!this.app.vault.getAbstractFileByPath(filePath)) {
				try {
					await this.app.vault.create(filePath, '')
				} catch (e) {
					console.warn('Could not create file', filePath, e)
				}
			}
		}

		// Build the link to insert according to settings
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

		value.context.editor.replaceRange(
			link,
			value.context.start,
			value.context.end,
		)
	}
}

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
