import { LayaBrowserAgent } from "./LayaBrowserAgent"

const agent = new LayaBrowserAgent({
  endpoint: "http://127.0.0.1:8765",
  confidenceThreshold: 0.72,
  completionThreshold: 0.88,
  maxCandidates: 16,
})

const result = await agent.execute("打开文档页面")
console.table(result.steps)
console.log(result)
