# Laya BrowserAgent MVP

An experimental non-autoregressive Browser Agent built on the Alibaba PageAgent
`PageController` DOM extraction and indexed action layer.

## Architecture

```text
Live DOM
  -> PageAgent PageController
  -> simplified indexed DOM
  -> candidate generator (max 16)
  -> Laya choice + completion probability
  -> click / input / scroll
  -> next DOM snapshot
```

There is no generative LLM in this loop. That makes it a clean baseline for asking how far a
System-1 decision model can get on browser tasks.

## 1. Start Laya

```bash
cd examples/laya-browser-agent
python -m venv .venv

# Windows
.venv\\Scripts\\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
python laya-server.py
```

Optional environment variables:

- `LAYA_DEVICE=cuda` to force CUDA
- `LAYA_PRELOAD=1` to preload checkpoints
- `LAYA_MAX_LOADED=2` to keep English + multilingual models hot

Health check: `http://127.0.0.1:8765/health`.

## 2. Run the BrowserAgent

Use `LayaBrowserAgent.mts` from a PageAgent dev page or import it into a small demo entry:

```ts
import { LayaBrowserAgent } from "./LayaBrowserAgent"

const agent = new LayaBrowserAgent({
  endpoint: "http://127.0.0.1:8765",
  confidenceThreshold: 0.72,
})

const result = await agent.execute("搜索 MacBook Pro")
console.table(result.steps)
```

## MVP action space

- click any indexed interactive element
- input text when it can be deterministically extracted from the task (quoted text or a search intent)
- scroll up/down
- stop successfully when the `task_complete` probability crosses the threshold

Select/combobox parameters and arbitrary generated text are intentionally not supported yet.

## Why cap candidates?

The Laya README reports weaker performance on high-cardinality choice spaces. The MVP ranks DOM
elements by simple overlap with the task and sends at most 16 actions to Laya.

## What to benchmark next

Run the same PageAgent task set in two modes:

1. original PageAgent LLM loop
2. this Laya-only loop

Track success rate, decision latency, end-to-end latency, steps per task, and failure reason.
The next iteration should add a hybrid fallback for low-confidence and parameterized steps.
