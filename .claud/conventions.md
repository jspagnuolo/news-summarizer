# Coding Conventions

## JavaScript Style
- ES6+ modules (import/export)
- Async/await over promises
- Descriptive variable names
- Comments for complex logic only
- Use const by default, let when reassignment needed
- Arrow functions for callbacks
- Template literals for string interpolation

## Error Handling
- Try/catch for all external API calls
- Graceful degradation (continue if one feed fails)
- Structured logging with context
- Never throw unhandled errors in production
- Return null/default values on non-critical failures
- Log errors with context (topic, feed, step)

## File Organization
- Keep related functionality together
- Separate concerns (fetching, parsing, summarization, git operations)
- Utils for shared functions
- Config in dedicated files
- One export per module (prefer default export for main function)
- Group imports: external deps, then local modules

## API Integration
- Always include error handling
- Log requests/responses for debugging
- Respect rate limits
- Use environment variables for all secrets
- Implement retry logic with exponential backoff
- Validate responses before processing

## Git Workflow
- Descriptive commit messages (present tense, imperative mood)
- Test locally before pushing
- Update CHANGELOG.md for user-facing changes
- Keep README.md current
- Commit incrementally (small, focused commits)
- Include co-authorship for AI assistance

## Cost Consciousness
- Monitor token usage
- Cache when appropriate (with TTL)
- Minimize API calls
- Flag expensive operations in code comments with 💰
- Log token usage for each OpenAI call
- Use efficient algorithms (avoid O(n²) when possible)

## Logging Standards
- Use console.log for info
- Use console.error for errors with full context
- Include emojis for visual scanning: 📰 (fetch), ✅ (success), ❌ (error), ⚠️ (warning)
- Log timestamps implicitly (Cloudflare adds them)
- Structure: `[STEP] message - context`
