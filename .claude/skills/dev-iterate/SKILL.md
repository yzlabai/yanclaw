---
name: dev-iterate
description: "Execute a structured development iteration: plan → implement → validate → review. Use when implementing features, fixing bugs, or making any code changes that need a disciplined workflow."
argument-hint: "[task description or issue reference]"
---

# Development Iteration Workflow

You are executing a structured development iteration for: **$ARGUMENTS**

Follow this workflow strictly. Each phase must complete before moving to the next. Use TodoWrite to track progress through the phases.

---

## Phase 0: Context Loading (必做)

Before anything else, load the project context:

1. Read `CLAUDE.md` for project conventions, architecture, and commands
2. Read the memory index at `~/.claude/projects/d--ai-works-yanclaw/memory/MEMORY.md` for project state
3. If the task references specific files, read them now
4. If the task is vague, use Explore agent to understand the relevant code area

**Gate**: You must understand the affected modules, their dependencies, and the project's coding patterns before proceeding.

---

## Phase 1: Planning (设计)

Create a clear, minimal plan before writing any code:

1. **Scope**: Define exactly what changes are needed. List affected files.
2. **Approach**: Choose the simplest approach that solves the problem. Consider:
   - Does this follow existing patterns in the codebase?
   - What's the minimum change that works?
   - Are there edge cases that matter now (not hypothetically)?
3. **Risk Check**: Identify anything that could break:
   - What existing functionality could be affected?
   - Are there type-safety implications?
   - Security considerations?
4. **Dependencies**: Note if this requires config schema changes, new packages, or API changes.

Write the plan as a TodoWrite task list. If the task is non-trivial (>3 files or architectural change), enter Plan mode to align with the user before proceeding.

**Gate**: User should see and approve the plan for non-trivial changes.

---

## Phase 2: Implementation (实现)

Execute the plan. Follow these rules strictly:

### Code Quality Rules
- **Follow existing patterns**: Match the style, structure, and conventions of surrounding code. Don't introduce new patterns unless the task requires it.
- **Minimum viable change**: Only modify what's necessary. Don't refactor, clean up, or "improve" adjacent code.
- **Type safety**: Maintain the project's end-to-end type chain (Hono → AppType → hc). If you add/change a route, the types must flow through.
- **Zod validation**: All new API inputs must have Zod schemas with `zValidator`.
- **No over-engineering**: No premature abstractions, no feature flags for simple changes, no "just in case" error handling.
- **Security-first**: Check OWASP top 10. Validate at system boundaries. Use parameterized queries. Sanitize user input.

### Implementation Order
1. **Schema/types first**: If config or DB schema changes are needed, do them first.
2. **Backend logic**: Implement server-side changes.
3. **API routes**: Wire up HTTP/WS endpoints.
4. **Frontend**: Build the UI last (it depends on the API types).
5. **Wiring**: Connect everything in `app.ts`, `gateway.ts`, etc.

### Progress Tracking
- Mark each TodoWrite task as completed when done.
- If you discover the plan needs adjustment during implementation, update the plan and note why.

---

## Phase 3: Validation (验证)

Run the full validation gate. Do NOT skip any step.

```bash
# Step 1: Format check (auto-fix)
bun run format

# Step 2: Lint check
bun run check

# Step 3: Type check (implicit in build)
bun run build

# Step 4: Tests
bun run test
```

### Validation Rules
- **Fix, don't suppress**: If lint/type errors appear, fix the root cause. Don't add `// @ts-ignore`, `// biome-ignore`, or suppress warnings.
- **All 4 steps must pass**: If any step fails, fix the issue and re-run from that step.
- **New code needs to pass existing tests**: If your change breaks existing tests, your change is wrong (unless the test expectations need updating for the new behavior).
- **Iterate until green**: Keep fixing until all 4 steps pass cleanly.

---

## Phase 4: Self-Review (审查)

Before declaring done, review your own changes:

1. **Read the diff**: `git diff` all changed files. Look for:
   - Accidentally committed debug code (`console.log`, `debugger`)
   - Hardcoded values that should be config
   - Missing error handling at system boundaries
   - Security issues (XSS, injection, SSRF, credential exposure)
   - Leftover TODO comments or incomplete implementations
2. **Type chain integrity**: If routes changed, verify `AppType` still exports correctly and the frontend `hc<AppType>()` would pick up the changes.
3. **Config schema**: If you added config fields, verify they have sensible defaults and the schema validates correctly.
4. **Backward compatibility**: Will this break existing user configs or data?

### Review Checklist
- [ ] No debug artifacts in code
- [ ] All new functions have clear intent (self-documenting names)
- [ ] Error messages are actionable (tell the user what to do)
- [ ] No secrets or credentials in code
- [ ] Import paths use workspace aliases (`@yanclaw/server/*`, etc.)
- [ ] Biome formatting applied (tabs, double quotes, semicolons)

---

## Phase 5: Documentation (文档)

Only update docs if the change is user-visible:

1. **CHANGELOG.md**: Add entry if this is a feature, notable fix, or breaking change. One line, Chinese, under the current version heading.
2. **CLAUDE.md**: Update if you added new architectural patterns, key modules, or conventions that future development needs to know about.
3. **Config docs**: If new config fields were added, ensure `docs/` reflects them.
4. **Memory**: If you learned something about the project that's not in code or docs, save it to the memory system.

**Do NOT**: Create new README files, add JSDoc to unchanged functions, or write design docs unless explicitly asked.

---

## Phase 6: Summary (总结)

Provide a brief summary to the user:

1. **What changed**: List of files modified and why (1 line each)
2. **What to test manually**: If applicable, steps for the user to verify
3. **Known limitations**: Anything intentionally deferred or simplified
4. **Next steps**: If this is part of a larger effort, what comes next

Keep the summary concise. The user can read the diff for details.

---

## Error Recovery

If you get stuck at any phase:

- **Phase 1 (Planning)**: Ask the user for clarification. Don't guess at requirements.
- **Phase 2 (Implementation)**: If the approach isn't working after 2 attempts, step back and reconsider the plan. Don't brute-force.
- **Phase 3 (Validation)**: If a test failure is unrelated to your changes, note it and move on. If it's related, fix it.
- **Phase 4 (Review)**: If you find a significant issue in your own review, go back to Phase 2 to fix it before proceeding.

## Anti-Patterns (绝对不要)

- Don't start coding before reading the relevant existing code
- Don't add features that weren't asked for
- Don't refactor code you didn't need to touch
- Don't add comments to explain obvious code
- Don't create utility files for one-off operations
- Don't add backward-compatibility shims — just change the code
- Don't skip validation because "it's a small change"
- Don't suppress linter/type errors instead of fixing them
- Don't commit without running the full validation gate
