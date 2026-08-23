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
// Fake syntax tree, placed over document offsets so a test can prove WHICH
// position the plugin inspects, not merely that it reacts to a token.
//
// `tokenState.ranges` holds [from, to, spec] entries and resolveInner honours
// the `side` argument the way lezer does: with side > 0 a token that merely
// ends at the offset does not match. A spec is either a class string, or
// { classes, parent } to nest nodes, { classes, nameOnly: true } to hide the
// prop, or { broken } for hostile shapes.
//
// Obsidian exposes a node's stream-parser classes as a space-separated string
// through tokenClassNodeProp; CM6 builds the node name from that same string
// with the spaces turned into underscores, so the fake mirrors both shapes.
const tokenState = { ranges: [], throws: false }
const makeNode = (spec) => {
	if (typeof spec === 'string') spec = { classes: spec }
	if (spec.broken === 'type') return { parent: null, type: undefined }
	if (spec.broken === 'prop') return { parent: null, type: { name: 'x', prop: 'not a function' } }
	return {
		parent: spec.parent ? makeNode(spec.parent) : null,
		type: {
			name: spec.classes.split(' ').join('_'),
			prop: (p) => spec.nameOnly ? undefined : (p === cmStub.tokenClassNodeProp ? spec.classes : undefined),
		},
	}
}
const cmStub = {
	ViewPlugin: { fromClass: () => ({}) },
	Decoration: { mark: () => ({}) },
	RangeSetBuilder: class { add() {} finish() { return {} } },
	syntaxTree: () => {
		if (tokenState.throws === 'throw') throw new Error('syntax tree unavailable')
		if (tokenState.throws === 'no-resolveInner') return { iterate() {} }
		return {
			iterate() {},
			resolveInner: (offset, side) => {
				const hit = tokenState.ranges.find(([from, to]) => side > 0
					? offset >= from && offset < to
					: offset > from && offset <= to)
				return hit ? makeNode(hit[2]) : null
			},
		}
	},
	tokenClassNodeProp: { name: 'tokenClass' },
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

	console.log('\n--- Mentions only in prose, not in code/frontmatter/math ---')
	// An editor exposing a CM6 view, so the syntax check runs at all. Without
	// `cm` (every other test here) the check must fail open and trigger.
	const cmEditorFor = (line, extra) => Object.assign({
		getLine: () => line,
		cm: { state: {} },
		posToOffset: (pos) => pos.ch,
	}, extra)
	// `ranges` are offsets over `line`, so these assertions pin down which
	// position the plugin inspects, not just that it reacts to some token.
	const triggerWith = (line, ch, ranges, opts = {}) => {
		tokenState.ranges = ranges
		tokenState.throws = opts.throws || false
		suggestor.dismissedTrigger = null
		const r = suggestor.onTrigger({ line: 0, ch }, cmEditorFor(line, opts.editor), null)
		return r ? `q=${r.query}` : null
	}
	// "@Jo" with the '@' at offset 0 and the whole line inside one token.
	const wholeLine = (classes) => triggerWith('@Jo', 3, [[0, 3, classes]])

	check('fenced code block', wholeLine('hmd-codeblock'), null)
	check('code block with highlighting', wholeLine('hmd-codeblock keyword'), null)
	check('inline code', wholeLine('inline-code'), null)
	check('YAML frontmatter', wholeLine('hmd-frontmatter'), null)
	check('math', wholeLine('math'), null)
	check('inside an existing wikilink', wholeLine('hmd-internal-link'), null)
	check('plain prose still triggers', wholeLine(''), 'q=Jo')
	check('bold prose still triggers', wholeLine('strong em'), 'q=Jo')
	check('no token at all still triggers', triggerWith('@Jo', 3, []), 'q=Jo')
	// Substring lookalikes must not suppress: classes are compared whole.
	check('"mathematica" is not math', wholeLine('mathematica'), 'q=Jo')
	check('"inline-code-block" is not inline code', wholeLine('inline-code-block'), 'q=Jo')

	// The '@' decides, not the cursor: here the cursor has already moved past
	// the closing backtick, so a cursor-based check would let this through.
	//        0123456789..     ranges cover the code span, offsets 5..12
	check('code span, cursor past the closer', triggerWith('mira `x @Jo`', 12, [[5, 12, 'inline-code']]), null)
	// side = 1: a token that merely ENDS at the '@' must not suppress it.
	check('token ending at the @ does not suppress', triggerWith('texto @Jo', 9, [[0, 6, 'inline-code']]), 'q=Jo')
	// The class may sit on an ancestor: inside a highlighted fence the leaf is
	// a language token and 'hmd-codeblock' is above it.
	check('class on an ancestor node', triggerWith('@Jo', 3, [[0, 3, { classes: 'VariableName', parent: { classes: 'hmd-codeblock' } }]]), null)
	// Fallback path: no prop, classes only in the underscore-joined node name.
	check('classes read from the node name', triggerWith('@Jo', 3, [[0, 3, { classes: 'hmd-codeblock keyword', nameOnly: true }]]), null)

	// Fail open: nothing about a tree read may silence the suggester.
	check('tree that throws', triggerWith('@Jo', 3, [[0, 3, 'hmd-codeblock']], { throws: 'throw' }), 'q=Jo')
	check('tree without resolveInner', triggerWith('@Jo', 3, [[0, 3, 'hmd-codeblock']], { throws: 'no-resolveInner' }), 'q=Jo')
	check('node without a type', triggerWith('@Jo', 3, [[0, 3, { broken: 'type' }]]), 'q=Jo')
	check('type.prop not a function', triggerWith('@Jo', 3, [[0, 3, { broken: 'prop' }]]), 'q=Jo')
	check('posToOffset that throws', triggerWith('@Jo', 3, [[0, 3, 'hmd-codeblock']], {
		editor: { posToOffset: () => { throw new Error('detached') } },
	}), 'q=Jo')
	check('editor without a CM6 view', triggerWith('@Jo', 3, [[0, 3, 'hmd-codeblock']], { editor: { cm: null } }), 'q=Jo')
	tokenState.ranges = []
	tokenState.throws = false

	console.log('\n--- The Escape veto is per file ---')
	const fileA = { path: 'Notes/A.md' }
	const fileB = { path: 'Notes/B.md' }
	const dismissIn = (file) => {
		suggestor.dismissedTrigger = null
		const ed = { getLine: () => '@Jo', getCursor: () => ({ line: 0, ch: 3 }) }
		suggestor.onTrigger({ line: 0, ch: 3 }, ed, file)
		suggestor.context = { editor: ed, file, start: { line: 0, ch: 0 }, end: { line: 0, ch: 3 }, query: 'Jo' }
		suggestor.close()
		suggestor.context = null
	}
	const triggersIn = (file) => {
		const r = suggestor.onTrigger({ line: 0, ch: 4 }, { getLine: () => '@Joh' }, file)
		return r ? `q=${r.query}` : null
	}

	dismissIn(fileA)
	check('same file, same spot: still vetoed', triggersIn(fileA), null)
	dismissIn(fileA)
	check('other file, same spot: not vetoed', triggersIn(fileB), 'q=Joh')

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
