// Regression harness for the At People suggester. Run with: npm test
// Stubs the 'obsidian' and '@codemirror/*' modules so main.js can be required
// outside Obsidian, then drives the suggester directly. The "Escape dismissal"
// section simulates Obsidian's own EditorSuggest cycle (trigger/showSuggestions/
// close semantics, verified against obsidian.asar) — see the comment there.
const Module = require('module')
const path = require('path')

class Stub {
	constructor() { this.scope = { register() {} } }
	setPlaceholder() {}
	open() { Stub.opened = this }
}
class EditorSuggestStub {
	constructor(app) { this.app = app; this.scope = { register() {} } }
	close() {}
}
class PluginStub {
	constructor(app, manifest) { this.app = app; this.manifest = manifest }
	async loadData() { return {} }
	async saveData() {}
	registerEvent() {}
	registerMarkdownPostProcessor() {}
	registerEditorExtension() {}
	addSettingTab() {}
	addCommand(cmd) { PluginStub.commands = (PluginStub.commands || []).concat(cmd) }
	registerEditorSuggest(s) { PluginStub.captured = s }
}

const obsidianStub = {
	AbstractInputSuggest: Stub,
	EditorSuggest: EditorSuggestStub,
	SuggestModal: Stub,
	Notice: class { constructor(m) { this.m = m } },
	Plugin: PluginStub,
	PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin } },
	Setting: class { setName() { return this } setDesc() { return this } setHeading() { return this } },
	editorLivePreviewField: {},
	editorInfoField: {},
}
const cmStub = {
	ViewPlugin: { fromClass: () => ({}) },
	Decoration: { mark: () => ({}) },
	RangeSetBuilder: class { add() {} finish() { return {} } },
	syntaxTree: () => ({ iterate() {} }),
	tokenClassNodeProp: {},
}

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
	if (request === 'obsidian') return obsidianStub
	if (request.startsWith('@codemirror/')) return cmStub
	return origLoad.apply(this, arguments)
}

global.document = {
	body: { classList: { toggle() {}, remove() {}, add() {} } },
	createDocumentFragment: () => ({ childNodes: [], appendChild() {} }),
	createElement: () => ({ appendChild() {}, set textContent(v) {} }),
	createTextNode: () => ({}),
}
global.window = { setTimeout: (fn) => fn() }

const app = {
	vault: {
		on() {},
		fileMap: {
			'People/@John Doe.md': {},
			'People/@Ana Ruiz.md': {},
			// Already-contaminated file: its canonical name carries stray spaces.
			'People/@ Zoe Ramos .md': {},
			// Same relevance for the query "zoe", but a clean name.
			'People/@Zoe Martins.md': {},
		},
		getAbstractFileByPath: () => null,
		getAllFolders: () => [],
	},
	metadataCache: {
		on() {},
		getFileCache: () => ({}),
		getFirstLinkpathDest: () => null,
		getBacklinksForFile: () => ({ data: new Map() }),
	},
	workspace: { onLayoutReady: (fn) => fn() },
}

const AtPeople = require(path.join(__dirname, '..', 'main.js'))

let pass = 0, fail = 0
const check = (label, actual, expected) => {
	const ok = actual === expected
	if (ok) pass++; else fail++
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`}`)
}

const main = async () => {
	const plugin = new AtPeople(app, {})
	await plugin.onload()
	const suggestor = PluginStub.captured

	console.log('\n--- onTrigger: which characters may precede the @ ---')
	const triggers = (line) => {
		suggestor.dismissedTrigger = null
		const editor = { getLine: () => line }
		const r = suggestor.onTrigger({ line: 0, ch: line.length }, editor, null)
		return r ? `ch=${r.start.ch} q=${r.query}` : null
	}

	// Should trigger
	check('start of line: "@Jo"', triggers('@Jo'), 'ch=0 q=Jo')
	check('after space: "hola @Jo"', triggers('hola @Jo'), 'ch=5 q=Jo')
	check('after "(": "(@Jo"', triggers('(@Jo'), 'ch=1 q=Jo')
	check('after quote: "\\"@Jo"', triggers('"@Jo'), 'ch=1 q=Jo')
	check('after dash: "-@Jo"', triggers('-@Jo'), 'ch=1 q=Jo')
	check('after tab: "\\t@Jo"', triggers('\t@Jo'), 'ch=1 q=Jo')
	check('after quote block: ">@Jo"', triggers('>@Jo'), 'ch=1 q=Jo')
	check('after "¿": "¿@Jo"', triggers('\u00bf@Jo'), 'ch=1 q=Jo')
	check('md link: "[Nota](@Jo"', triggers('[Nota](@Jo'), 'ch=7 q=Jo')
	check('after "/": "a/@Jo"', triggers('a/@Jo'), 'ch=2 q=Jo')

	// Should NOT trigger
	check('email: "mail@Jo"', triggers('mail@Jo'), null)
	check('accented letter: "Jos\u00e9@Jo"', triggers('Jos\u00e9@Jo'), null)
	check('digit: "5@Jo"', triggers('5@Jo'), null)
	check('underscore: "a_@Jo"', triggers('a_@Jo'), null)
	check('wikilink: "[[@Jo"', triggers('[[@Jo'), null)
	check('double at: "@@Jo"', triggers('@@Jo'), null)
	check('no query: "@"', triggers('@'), null)
	check('closed link: "@Jo]]"', triggers('@Jo]]'), null)
	// Inline code stays quiet: an '@' right after a backtick is an identifier
	// ("`@param", "`@media"), not a mention.
	check('backtick: "`@param"', triggers('`@param'), null)
	// The prefix check must see code points, not UTF-16 units: a combining mark
	// (NFD input) and an astral letter both end the previous word.
	check('NFD accent: "Jose\\u0301@Jo"', triggers('José@Jo'), null)
	check('astral letter: "\\u{20000}@Jo"', triggers('\u{20000}@Jo'), null)

	// The '@' belongs glued to the name. A space after it means the '@' is being
	// used as a word ("Cena @ 21:00"), not opening a mention.
	check('space after the @: "@ Juan"', triggers('@ Juan'), null)
	check('several spaces: "@    Juan"', triggers('@    Juan'), null)
	check('tab after the @', triggers('@\tJuan'), null)
	check('"@" as a word: "Cena @ 21:00"', triggers('Cena @ 21:00'), null)
	check('"@" as a word: "reunion @ la oficina"', triggers('reunion @ la oficina'), null)

	// A space further along is part of the name and must not stop the search.
	const queryOf = (line) => {
		suggestor.dismissedTrigger = null
		const r = suggestor.onTrigger({ line: 0, ch: line.length }, { getLine: () => line }, null)
		return r ? JSON.stringify(r.query) : null
	}
	check('trailing space kept (mobile keyboard)', queryOf('@Juan '), '"Juan "')
	check('inner space kept', queryOf('@Juan Pe'), '"Juan Pe"')

	console.log('\n--- selectSuggestion: trailing space ---')
	const inserted = async (line, endCh) => {
		let captured = null
		const editor = {
			getLine: () => line,
			replaceRange: (text) => { captured = text },
		}
		await suggestor.selectSuggestion({
			suggestionType: 'set',
			displayText: 'John Doe',
			matchedAlias: null,
			context: { editor, start: { line: 0, ch: 0 }, end: { line: 0, ch: endCh }, query: 'Jo' },
		})
		return captured
	}

	// Off by default: an update must not change how anyone's typing behaves.
	check('default is off: no space added', plugin.settings.addTrailingSpace, false)
	check('off: end of line', await inserted('@Jo', 3), '[[@John Doe]]')
	check('off: before a word', await inserted('@Jotexto', 3), '[[@John Doe]]')

	plugin.settings.addTrailingSpace = true
	check('on: end of line adds a space', await inserted('@Jo', 3), '[[@John Doe]] ')
	check('on: space already there, no double', await inserted('@Jo hola', 3), '[[@John Doe]]')
	check('on: before ")", no space', await inserted('(@Jo)', 4), '[[@John Doe]]')
	check('on: before ",", no space', await inserted('@Jo, y luego', 3), '[[@John Doe]]')
	check('on: before a word adds a space', await inserted('@Jotexto', 3), '[[@John Doe]] ')
	plugin.settings.addTrailingSpace = false

	console.log('\n--- Escape dismissal vs. a popup that closes on its own ---')
	// Faithful to Obsidian's own code (obsidian.asar):
	//   EditorSuggest.trigger():   onTrigger() null -> context = null, return false
	//                              onTrigger() ok   -> context set, and only when
	//                              (force || isOpen) getSuggestions() runs
	//   showSuggestions(list):     empty list -> this.close()
	//   EditorSuggest.close():     context = null, then the popup closes
	//   manager.trigger():         no suggest returned true -> manager.close()
	//   onViewClick():             manager.close() right away, while the trigger
	//                              that follows a cursor move is debounced 50ms,
	//                              so close() sees a context that is still set
	const ed = {
		state: { line: '', ch: 0 },
		getLine: () => ed.state.line,
		getCursor: () => ({ line: 0, ch: ed.state.ch }),
		replaceRange: () => {},
	}
	let isOpen = false
	const closeFromObsidian = () => { suggestor.close(); suggestor.context = null; isOpen = false }
	const trigger = (force) => {
		const cursor = { line: 0, ch: ed.state.ch }
		const r = suggestor.onTrigger(cursor, ed, null)
		if (!r) { suggestor.context = null; closeFromObsidian(); return null }
		suggestor.context = { editor: ed, file: null, ...r }
		if (force || isOpen) {
			const list = suggestor.getSuggestions(suggestor.context)
			if (list.length) isOpen = true
			else closeFromObsidian()
		}
		return `q=${JSON.stringify(r.query)}${isOpen ? '' : ' (no popup)'}`
	}
	const reset = () => { suggestor.dismissedTrigger = null; suggestor.context = null; suggestor._selectionMade = false; isOpen = false }
	const type = (line, ch) => {
		ed.state.line = line
		ed.state.ch = ch === undefined ? line.length : ch
		return trigger(true)
	}
	const pressEscape = () => closeFromObsidian()
	const clickAt = (ch) => { ed.state.ch = ch; closeFromObsidian(); trigger(false) }

	reset()
	check('"@ " is not a mention at all', type('@ '), null)
	check('deleting the space', type('@'), null)
	check('typing glued to the @ opens it', type('@j'), 'q="j"')

	reset()
	type('@ ')
	type('@')
	check('and after removing the @ too', (type(''), type('@x')), 'q="x"')

	reset()
	check('a query nothing matches: no veto', (type('@///'), type('@///j')), 'q="///j"')
	// The list just recovered from empty; an Escape now is a real dismissal and
	// must veto again (lastListWasEmpty was refreshed by the recovery).
	check('Escape right after recovering vetoes', (pressEscape(), type('@///jx')), null)

	reset()
	check('Escape suppresses the same @', (type('@jo'), pressEscape(), type('@joh')), null)
	check('and keeps suppressing while typing', type('@john'), null)
	check('another line is unaffected', suggestor.onTrigger({ line: 1, ch: 3 }, { getLine: () => '@jo' }, null) !== null, true)

	reset()
	type('hola @jo')
	clickAt(0)
	check('clicking away is not a dismissal', type('hola @joh'), 'q="joh"')

	console.log('\n--- "New person" name: trim + illegal characters ---')
	// Returns the displayText of the 'create' entry, or null when there is none.
	const newPerson = (query) => {
		const entry = suggestor.getSuggestions({ query, editor: null }).find(s => s.suggestionType === 'create')
		return entry ? entry.displayText : null
	}

	check('trailing space (mobile keyboard)', newPerson('Nuevo Nombre '), 'Nuevo Nombre')
	check('leading space', newPerson(' Nuevo'), 'Nuevo')
	check('both ends', newPerson('  Nuevo Nombre  '), 'Nuevo Nombre')
	// Doubled inner spaces are invisible in the popup (the DOM collapses runs of
	// whitespace), so leaving them in would create people that look identical.
	check('inner spaces are collapsed', newPerson('John  Doe '), 'John Doe')
	check('several runs collapsed', newPerson('John   van  Doe'), 'John van Doe')
	check('gap left by a stripped char', newPerson('Ana  :  jefa'), 'Ana jefa')
	check('single spaces untouched', newPerson('Maria del Mar Ruiz'), 'Maria del Mar Ruiz')
	check('slash would create a subfolder', newPerson('John/Doe'), 'JohnDoe')
	check('colon is illegal on Windows', newPerson('Ana: jefa'), 'Ana jefa')
	check('wikilink breakers "#^|[]"', newPerson('a#b^c|d[e]f'), 'abcdef')
	check('quotes and wildcards', newPerson('J"o*n?'), 'Jon')
	check('leading @s and spaces all stripped', newPerson('@@ @x'), 'x')
	check('only spaces: nothing to create', newPerson('   '), null)
	check('only illegal chars: nothing to create', newPerson('///'), null)
	check('existing people are still listed', suggestor.getSuggestions({ query: 'john', editor: null })[0].displayText, 'John Doe')

	console.log('\n--- Existing names are never rewritten ---')
	const ranked = suggestor.getSuggestions({ query: 'zoe', editor: null }).filter(s => s.suggestionType === 'set')
	check('stray-space file keeps its real name', ranked.map(s => s.displayText).includes(' Zoe Ramos '), true)
	check('and is not pushed down by the spaces', ranked[0].displayText, ' Zoe Ramos ')

	console.log('\n--- "Link selected text" modal ---')
	const cmd = PluginStub.commands.find(c => c.id === 'link-selection-to-person')
	const runCmd = (selection) => {
		Stub.opened = null
		cmd.editorCallback({
			getSelection: () => selection,
			getCursor: () => ({ line: 0, ch: 0 }),
			replaceRange: () => {},
		}, null)
		return Stub.opened
	}
	const modal = runCmd('@Pepe ')
	const modalCreate = modal.getSuggestions('').find(s => s.type === 'create')
	check('selection "@Pepe " creates "Pepe"', modalCreate ? modalCreate.name : null, 'Pepe')
	const emptyModal = runCmd('  ')
	check('blank selection: nothing to create', emptyModal.getSuggestions('').some(s => s.type === 'create'), false)

	console.log(`\n${pass} passed, ${fail} failed`)
	process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
