---
name: learn
description: Capture a hard-won lesson so the same mistake is never repeated, and recall past lessons before risky actions. Use this skill whenever an error → root-cause → fix cycle just completed, the user corrected a wrong assumption, something cost real debugging time, or the user says "記下來 / remember this / don't make this mistake again" or runs /learn. Also consult it BEFORE editing parsers, job_manager, running builds, or other operations where past pitfalls exist.
---

# Self-Learning (踩坑捕捉 + 召回)

This skill makes Claude smarter about **this project over time** by turning real mistakes
into durable memories. Storage is easy — the hard part is (a) only recording signal, and
(b) recalling it at the right moment next time. This skill enforces both as a discipline.

The store is the **existing memory system** — do NOT invent a parallel store:

```
~/.claude/projects/D--Google-AI-VizCode/memory/
  MEMORY.md          # the index loaded every session — one line per memory
  pitfall_*.md       # one lesson per file (this skill's output)
```

---

## A. CAPTURE — when a mistake just got fixed

### 1. Apply the bar (most candidates should be REJECTED)
Record a lesson **only** if it is **all three**:
- **Cost real time** — debugging, a wrong path explored, a user correction. Not a typo.
- **Non-obvious** — not derivable from CLAUDE.md, the code, or git history. (If it's in
  the repo already, don't duplicate it — that's noise.)
- **Likely to recur** — a trap the next session would also fall into.

A failed `grep` with no matches, an expected test failure, a one-off typo → **do not record**.
When unsure, lean toward NOT recording. A noisy `MEMORY.md` destroys recall precision.

### 2. Dedup FIRST (prevents MEMORY.md bloat)
Before writing, read `MEMORY.md` and skim for an existing memory covering this.
- **Exists** → update that file (sharpen the lesson, add the new trigger). Do NOT add a new line.
- **New** → continue to step 3.

### 3. Write the lesson file
Path: `~/.claude/projects/D--Google-AI-VizCode/memory/pitfall_<short-kebab-slug>.md`

Use `type: feedback` so it stays consistent with the existing memory system and the global
memory format (Why / How to apply):

```markdown
---
name: pitfall_<short-kebab-slug>
description: <one line — phrase it as the TRIGGER SITUATION, not the conclusion, so it surfaces during recall. e.g. "Editing job_manager.py and the change silently does nothing">
metadata:
  node_type: memory
  type: feedback
---

**Symptom:** <what was observed that looked wrong>

**Root cause:** <the actual reason>

**Fix:** <what resolved it>

**Why:** <why this is a trap — what made it non-obvious>

**How to apply:** <the rule for next time — when you're about to do X, do/check Y first>

**Triggers when:** <files / operations that lead here — e.g. "any edit under src/parsers/", "running npm run build", "L1 perf work">

Related: [[other-memory-name]]
```

### 4. Add ONE index line to MEMORY.md
Append under the existing list:
```
- [<Title>](pitfall_<slug>.md) — <hook: the trap, in ~10 words>
```
The hook must describe **the situation that triggers it**, not just the answer — that's
what makes future-you recall it.

---

## B. RECALL — before a risky action

Before editing parsers, `job_manager.py`, `server.py`, running `npm run build`, touching
L1/Galaxy perf paths, or any area where a `pitfall_*`/`feedback_*` memory exists:
1. Scan the loaded `MEMORY.md` index for a matching **trigger situation**.
2. If a line matches, read that memory file and follow its **How to apply** before acting.

Treat recalled memories as *what was true when written* — if one names a file/flag/function,
verify it still exists before relying on it.

---

## C. Automatic safety net (the hook)

A `Stop` hook (`.claude/hooks/learn-nudge.py`) fires at most **once per session**: if any
tool error occurred this session, it emits a gentle reminder to evaluate whether a lesson
should be captured. It is non-blocking — it never forces a retry or loops. When you see that
reminder, apply the bar in section A; usually the answer is "no lesson needed", and that's fine.

---

## Notes
- Keep `MEMORY.md` curated: if two pitfalls overlap, merge them; delete any that turn out wrong.
- Lessons about *how the user wants me to work* (not error-driven) are still plain `feedback_*`
  memories — this skill is specifically for **mistakes that bit us**.
