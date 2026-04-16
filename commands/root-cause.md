---
description: "Identify the root cause of a problem using the 5 Whys technique"
argument-hint: "<problem description>"
---

# Root Cause Analysis

Identify the most plausible root cause of the given problem.

## Problem

```
$ARGUMENTS
```

## Instructions

Analyze, research, review and refine available resources (session, context, filesystem, data, tools, active MCPs, etc.) related to the problem above. Apply the "5 Whys" technique — "five" is a guideline, you may need more or fewer iterations to reach the root cause.

Provide a key preliminary conclusion at each step. Keep a brief trackable record of the process throughout completion.

## Checklist

- [ ] State the problem clearly
- [ ] Analyze why the problem occurred and identify the answer
- [ ] For each answer, ask "Why?" again
- [ ] Maintain record of each finding by appending to an RCA file in the project root (e.g., `RCA-{date}.md` or an existing `RCA.md`)
- [ ] Continue asking "Why?" about each subsequent answer until you reach a root cause or detect a cyclic loop
- [ ] Conclude the analysis with citations and references, without entering solution mode
