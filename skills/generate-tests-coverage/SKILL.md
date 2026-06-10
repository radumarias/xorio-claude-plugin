---
name: generate-tests-coverage
description: Scan the entire project for under-tested code and generate tests to fill coverage gaps. Prioritizes critical business logic.
disable-model-invocation: true
---

# Generate Tests for Coverage Gaps

Scan the entire project for under-tested code and generate tests to fill coverage gaps, prioritizing critical business logic.

## Workflow

### Step 1: Detect All Languages and Frameworks

Scan the project root to detect all languages and frameworks present:

**Languages:**
- `.rs` files or `Cargo.toml` → **Rust**
- `.ts`/`.tsx` files or `package.json` → **TypeScript**
- `.py` files or `pyproject.toml`/`setup.py` → **Python**

**Frameworks:**
- `Cargo.toml` contains `egui` → **egui**
- `package.json` contains `react` → **React**
- `package.json` contains `vue` → **Vue.js**
- `package.json` contains `three` → **Three.js**
- `package.json` contains `spark` → **SparkJS**
- `Dockerfile` or `docker-compose.yml` exists → **Docker**
- AWS SDK deps, CDK, CloudFormation, or SAM templates → **AWS**

### Step 2: Load All Matching Standards

Read all matching standards files from `${CLAUDE_PLUGIN_ROOT}/skills/tests/references/`:
- One `test-standards-{language}.md` per detected language
- One `test-standards-{framework}.md` per detected framework

### Step 3: Parallel Analysis

Launch `test-analyzer` agents in parallel, split by source directories for speed. Each gets its language's standards. Example splits:
- `crates/` → Rust analyzer with Rust + egui standards
- `tools/renderer/` → TypeScript analyzer with TS + Three.js standards
- `src/` → whichever language is present there

Also launch the `test-docs-advisor` agent in parallel for a full project documentation review.

### Step 4: Present Comprehensive Gap Analysis

Aggregate results from all analyzers and present:
1. **Project test health summary** — overall coverage assessment per language/module
2. **Critical gaps** — highest risk items across the project
3. **High/Medium/Low gaps** — remaining items by priority
4. **Documentation suggestions** from the docs advisor

Ask the user which gaps to fill. Suggest starting with Critical items.

### Step 5: Generate Tests

Launch `test-generator` agents — parallelize across independent modules:
- One agent per language/crate/package if they're independent
- Each gets only its language + framework standards
- Each gets its subset of the gap list

### Step 6: Validate All

Run all relevant validation commands:
- **Rust:** `cargo test`, `cargo clippy --all-targets --all-features`, `cargo fmt --check`
- **TypeScript:** `npm test`, `npx tsc --noEmit`
- **Python:** `pytest`, `mypy`, `ruff`
- **Docker:** `hadolint`, `docker build`
- **AWS:** `cdk synth`, `sam validate`, `cfn-lint` (if applicable)

### Step 7: Report

Provide a comprehensive report:
- Tests generated per module (file paths and test names)
- Validation results per language
- Remaining gaps not addressed (for future runs)
- Documentation improvements suggested
