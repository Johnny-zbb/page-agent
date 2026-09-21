import { LayaBrowserAgent } from './LayaBrowserAgent.mts'

const taskInput = document.querySelector<HTMLInputElement>('#task')!
const runButton = document.querySelector<HTMLButtonElement>('#run')!
const output = document.querySelector<HTMLPreElement>('#agent-output')!
const searchBox = document.querySelector<HTMLInputElement>('#search-box')!
const searchButton = document.querySelector<HTMLButtonElement>('#search-button')!
const searchResult = document.querySelector<HTMLParagraphElement>('#search-result')!
const docsButton = document.querySelector<HTMLButtonElement>('#docs-button')!
const docsPanel = document.querySelector<HTMLDivElement>('#docs-panel')!
const settingsButton = document.querySelector<HTMLButtonElement>('#settings-button')!
const settingsPanel = document.querySelector<HTMLDivElement>('#settings-panel')!

searchButton.addEventListener('click', () => {
	searchResult.textContent = searchBox.value
		? `搜索结果：${searchBox.value}`
		: '请输入搜索内容'
})

docsButton.addEventListener('click', () => {
	docsPanel.classList.remove('hidden')
})

settingsButton.addEventListener('click', () => {
	settingsPanel.classList.remove('hidden')
})

const agent = new LayaBrowserAgent({
	endpoint: 'http://127.0.0.1:8765',
	confidenceThreshold: 0.72,
	completionThreshold: 0.88,
	maxCandidates: 16,
})

runButton.addEventListener('click', async () => {
	runButton.disabled = true
	output.textContent = 'Running...'
	try {
		const result = await agent.execute(taskInput.value)
		output.textContent = JSON.stringify(result, null, 2)
		console.table(result.steps)
	} finally {
		runButton.disabled = false
	}
})
