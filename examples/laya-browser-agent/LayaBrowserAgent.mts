import { PageController, type BrowserState, type PageControllerConfig } from "@page-agent/page-controller"

export interface LayaBrowserAgentConfig {
  endpoint?: string
  confidenceThreshold?: number
  completionThreshold?: number
  maxCandidates?: number
  maxSteps?: number
  stepDelayMs?: number
  model?: string
  language?: string
  pageController?: PageController
  pageControllerConfig?: PageControllerConfig
  fetch?: typeof globalThis.fetch
}

export interface LayaBrowserStep {
  step: number
  action: string
  description: string
  confidence: number
  output: string
  decisionLatencyMs: number
}

export interface LayaBrowserAgentResult {
  success: boolean
  reason: string
  steps: LayaBrowserStep[]
  layaCalls: number
  totalLatencyMs: number
}

type BrowserAction =
  | { kind: "click"; index: number }
  | { kind: "input"; index: number; text: string }
  | { kind: "scroll"; down: boolean; numPages: number }

interface Candidate {
  id: string
  action: BrowserAction
  description: string
  relevance: number
  order: number
}

interface LayaResponse {
  answers?: {
    task_complete?: { noul?: number; confidence?: number }
    next_action?: { choice?: string; confidence?: number; probabilities?: Record<string, number> }
  }
  routing?: unknown
  [key: string]: unknown
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:8765"

export class LayaBrowserAgent {
  readonly pageController: PageController

  private readonly endpoint: string
  private readonly confidenceThreshold: number
  private readonly completionThreshold: number
  private readonly maxCandidates: number
  private readonly maxSteps: number
  private readonly stepDelayMs: number
  private readonly model?: string
  private readonly language?: string
  private readonly fetchFn: typeof globalThis.fetch
  private abortController = new AbortController()

  constructor(config: LayaBrowserAgentConfig = {}) {
    this.endpoint = (config.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "")
    this.confidenceThreshold = config.confidenceThreshold ?? 0.72
    this.completionThreshold = config.completionThreshold ?? 0.88
    this.maxCandidates = Math.max(2, Math.min(config.maxCandidates ?? 16, 24))
    this.maxSteps = config.maxSteps ?? 20
    this.stepDelayMs = config.stepDelayMs ?? 350
    this.model = config.model
    this.language = config.language
    this.fetchFn = (config.fetch ?? globalThis.fetch).bind(globalThis)
    this.pageController =
      config.pageController ??
      new PageController({ enableMask: true, ...(config.pageControllerConfig ?? {}) })
  }

  stop(): void {
    this.abortController.abort()
    void this.pageController.hideMask()
    void this.pageController.cleanUpHighlights()
  }

  dispose(): void {
    this.stop()
    this.pageController.dispose()
  }

  async execute(task: string): Promise<LayaBrowserAgentResult> {
    if (!task.trim()) throw new Error("Task is required")

    // Cancel any previous run. Each run captures its own controller so a stale
    // run observes the abort of its own run, never the signal of a newer one.
    this.abortController.abort()
    const abortController = new AbortController()
    this.abortController = abortController
    const startedAt = performance.now()
    const steps: LayaBrowserStep[] = []
    let layaCalls = 0

    await this.pageController.showMask()

    try {
      for (let step = 0; step < this.maxSteps; step++) {
        if (abortController.signal.aborted) {
          return this.finish(false, "Task stopped", steps, layaCalls, startedAt)
        }

        const browserState = await this.pageController.getBrowserState()

        if (abortController.signal.aborted) {
          return this.finish(false, "Task stopped", steps, layaCalls, startedAt)
        }

        const candidates = generateCandidates(task, browserState, this.maxCandidates)

        const decisionStartedAt = performance.now()
        const response = await this.decide(task, browserState, candidates, steps, abortController.signal)
        layaCalls++
        const decisionLatencyMs = performance.now() - decisionStartedAt

        const completionProbability = response.answers?.task_complete?.noul ?? 0
        if (completionProbability >= this.completionThreshold) {
          return this.finish(
            true,
            "Laya judged the browser task complete.",
            steps,
            layaCalls,
            startedAt
          )
        }

        if (candidates.length === 0) {
          return this.finish(
            false,
            "No executable elements on the page and Laya judged the task not complete.",
            steps,
            layaCalls,
            startedAt
          )
        }

        const choice = response.answers?.next_action?.choice
        const confidence = response.answers?.next_action?.confidence ?? 0
        const candidate = candidates.find((item) => item.id === choice)

        if (!candidate) {
          return this.finish(
            false,
            "Laya returned an unknown or missing action choice.",
            steps,
            layaCalls,
            startedAt
          )
        }

        if (confidence < this.confidenceThreshold) {
          return this.finish(
            false,
            "Laya confidence " + confidence.toFixed(3) + " is below threshold " + this.confidenceThreshold.toFixed(3) + ".",
            steps,
            layaCalls,
            startedAt
          )
        }

        if (abortController.signal.aborted) {
          return this.finish(false, "Task stopped", steps, layaCalls, startedAt)
        }

        const output = await this.executeAction(candidate.action)
        steps.push({
          step,
          action: candidate.action.kind,
          description: candidate.description,
          confidence,
          output,
          decisionLatencyMs,
        })

        if (this.stepDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.stepDelayMs))
        }
      }

      return this.finish(false, "Step limit reached", steps, layaCalls, startedAt)
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        return this.finish(false, "Task stopped", steps, layaCalls, startedAt)
      }
      return this.finish(false, String(error), steps, layaCalls, startedAt)
    } finally {
      // A stale run must not tear down UI that a newer run just set up.
      if (this.abortController === abortController) {
        await this.pageController.hideMask()
        await this.pageController.cleanUpHighlights()
      }
    }
  }

  private finish(
    success: boolean,
    reason: string,
    steps: LayaBrowserStep[],
    layaCalls: number,
    startedAt: number
  ): LayaBrowserAgentResult {
    return {
      success,
      reason,
      steps,
      layaCalls,
      totalLatencyMs: performance.now() - startedAt,
    }
  }

  private async decide(
    task: string,
    browserState: BrowserState,
    candidates: Candidate[],
    steps: LayaBrowserStep[],
    signal: AbortSignal
  ): Promise<LayaResponse> {
    const criteria = Object.fromEntries(candidates.map((item) => [item.id, item.description]))
    const state = {
      task,
      url: browserState.url,
      title: browserState.title,
      page_excerpt: browserState.content.slice(0, 3500),
      candidates: criteria,
      recent_actions: steps.slice(-4),
    }
    const questions: Record<string, unknown> = {
      task_complete: {
        type: "noul",
        instructions:
          "Is the user browser task already complete according to the current page and recent actions?",
      },
    }
    // Without candidates there is nothing to choose, so only ask for completion.
    if (candidates.length > 0) {
      questions.next_action = {
        type: "choice",
        instructions:
          "Which candidate is the single best safe browser action to make progress on the user task now?",
        criteria,
      }
    }

    const response = await this.fetchFn(this.endpoint + "/predict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, questions, model: this.model, lang: this.language }),
      signal,
    })

    if (!response.ok) {
      throw new Error("Laya sidecar returned HTTP " + response.status)
    }
    return (await response.json()) as LayaResponse
  }

  private async executeAction(action: BrowserAction): Promise<string> {
    if (action.kind === "click") {
      return (await this.pageController.clickElement(action.index)).message
    }
    if (action.kind === "input") {
      return (await this.pageController.inputText(action.index, action.text)).message
    }
    return (
      await this.pageController.scroll({ down: action.down, numPages: action.numPages })
    ).message
  }
}

function generateCandidates(task: string, browserState: BrowserState, maxCandidates: number): Candidate[] {
  const candidates: Candidate[] = []
  let order = 0

  for (const rawLine of browserState.content.split("\n")) {
    const line = rawLine.trim()
    const match = /^\*?\[(\d+)\]<([a-zA-Z][\w-]*)([^>]*)/.exec(line)
    if (!match) continue

    const index = Number(match[1])
    const tag = match[2].toLowerCase()
    const attributes = match[3].toLowerCase()

    if (isTextInput(tag, attributes)) {
      const text = inferInputText(task, line)
      if (text) {
        candidates.push({
          id: "a" + order,
          action: { kind: "input", index, text },
          description: "Input \"" + text + "\" into element [" + index + "]: " + line.slice(0, 150),
          relevance: relevance(task, line) + 0.2,
          order: order++,
        })
      }
      continue
    }

    if (tag === "select" || /role=(combobox|listbox)/.test(attributes)) continue

    candidates.push({
      id: "a" + order,
      action: { kind: "click", index },
      description: "Click element [" + index + "]: " + line.slice(0, 180),
      relevance: relevance(task, line),
      order: order++,
    })
  }

  if (!browserState.footer.includes("[End of page]")) {
    candidates.push({
      id: "a" + order,
      action: { kind: "scroll", down: true, numPages: 0.8 },
      description: "Scroll down 0.8 pages to inspect more content.",
      relevance: 0.03,
      order: order++,
    })
  }

  if (!browserState.header.includes("[Start of page]")) {
    candidates.push({
      id: "a" + order,
      action: { kind: "scroll", down: false, numPages: 0.8 },
      description: "Scroll up 0.8 pages to inspect earlier content.",
      relevance: 0.01,
      order: order++,
    })
  }

  return candidates
    .sort((a, b) => b.relevance - a.relevance || a.order - b.order)
    .slice(0, maxCandidates)
    .map((item, index) => ({ ...item, id: "a" + index }))
}

function isTextInput(tag: string, attributes: string): boolean {
  if (tag === "textarea") return true
  if (/role=(textbox|searchbox)/.test(attributes)) return true
  if (tag !== "input") return false
  return !/type=(button|submit|reset|checkbox|radio|image)/.test(attributes)
}

function inferInputText(task: string, elementLine: string): string | null {
  const quoted = /["“](.+?)["”]/.exec(task)
  if (quoted?.[1]) return quoted[1].trim()

  const isSearchLike = /(search|query|keyword|搜索|查询|查找)/i.test(elementLine)
  if (!isSearchLike) return null

  const zh = /(?:搜索|查询|查找)\s*[:：]?\s*(.+)$/u.exec(task)
  if (zh?.[1]) return zh[1].trim()
  const en = /(?:search(?: for)?|find)\s+(.+)$/i.exec(task)
  return en?.[1]?.trim() || null
}

function relevance(task: string, candidate: string): number {
  const taskTokens = tokenize(task)
  const candidateTokens = tokenize(candidate)
  if (taskTokens.size === 0 || candidateTokens.size === 0) return 0
  let overlap = 0
  for (const token of taskTokens) {
    if (candidateTokens.has(token)) overlap++
  }
  return overlap / taskTokens.size
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]+/g) ?? []
  const cjk = normalized.match(/[\u3400-\u9fff]/g) ?? []
  return new Set([...latin, ...cjk])
}
