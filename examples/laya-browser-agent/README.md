# Laya BrowserAgent MVP

An experimental non-autoregressive Browser Agent built on Alibaba PageAgent's existing
`PageController` DOM extraction and indexed action layer.

## Quick start

Use two terminals from the repository root.

### Terminal 1: start Laya

```bash
cd examples/laya-browser-agent
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python laya-server.py
```

On macOS/Linux, activate with `source .venv/bin/activate` instead.

Laya supports Python >=3.8; Python 3.11 is recommended for the smoothest PyTorch/Transformers setup.
The first request may download/build the model, so it can be much slower than warm inference.

Optional:

```powershell
$env:LAYA_DEVICE = "cuda"
$env:LAYA_PRELOAD = "1"
python laya-server.py
```

Check `http://127.0.0.1:8765/health` in the browser. It should return JSON with `"ok": true`.

### Terminal 2: start the browser playground

From the repository root:

```bash
npm install
npm run dev:laya
```

Open `http://localhost:5175`.

Try tasks such as:

- `搜索 MacBook Pro`
- `打开文档`
- `打开设置`

The page shows the final result JSON, including each action, confidence, decision latency, and
the number of Laya calls.

## Architecture

```text
Live DOM
  -> PageAgent PageController
  -> simplified indexed DOM
  -> candidate generator (max 16)
  -> Laya choice + completion probability
  -> click / deterministic input / scroll
  -> next DOM snapshot
```

There is no generative LLM in this loop. This is intentionally a clean baseline for measuring
how far a System-1 decision model can get on browser tasks.

## MVP action space

- click indexed interactive elements
- input text only when it can be deterministically extracted from the task
- scroll up/down
- stop when Laya's `task_complete` probability crosses the threshold

Select/combobox parameters and arbitrary generated text are intentionally not supported yet.

## What to benchmark next

Compare original PageAgent and this Laya-only loop on the same tasks. Track success rate,
decision latency, end-to-end latency, steps per task, and failure reason. The next iteration
should add a hybrid fallback for low-confidence and parameterized actions.
