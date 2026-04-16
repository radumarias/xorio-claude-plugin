# Planning Rules

## Analysis Approach

When analyzing code for planning purposes, treat it as a comprehensive PR review. Use IDE index graphs to map relationships between entities and identify reusable methods before proposing new ones. Always present the plan for human review before any implementation begins.

## Design Principles

Apply these principles consistently when creating plans:

**SOLID** - Single responsibility, Open-closed, Liskov substitution, Interface segregation, Dependency inversion.

**KISS** - Keep It Simple, Stupid. Favor straightforward solutions over clever complexity.

**DRY** - Don't Repeat Yourself. Identify duplication and consolidate.

**YAGNI** - You Ain't Gonna Need It. Don't add functionality until it's necessary.

**Convention over Configuration (CoC)** - Follow established patterns; only deviate when there's clear benefit.

**Law of Demeter (LoD)** - Minimize coupling; objects should only talk to immediate friends.

## Plan Structure

When presenting a plan, organize it as follows:

1. **Summary** - Brief overview of what changes are proposed and why
2. **Analysis Findings** - Key issues discovered during review
3. **Proposed Changes** - Grouped logically by module/concern
4. **Refactoring Opportunities** - Existing code that can be reused or improved
5. **New Code Requirements** - Only what cannot be achieved through refactoring
6. **Risk Assessment** - Breaking changes, dependencies affected, migration needs
7. **Implementation Order** - Suggested sequence to minimize conflicts

## Review Checklist

Before presenting any plan, verify:

- [ ] All design principles have been considered
- [ ] Existing code reuse has been maximized
- [ ] Changes are grouped into logical, reviewable chunks
- [ ] Risks and breaking changes are clearly identified
- [ ] The plan can be implemented incrementally
