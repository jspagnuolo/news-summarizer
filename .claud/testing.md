# Testing Strategy

## Local Testing
```bash
# Install dependencies
cd worker && npm install

# Run local dev server (Miniflare)
npx wrangler dev --local

# Trigger worker locally
curl -X POST http://localhost:8787/trigger

# Build Hugo site locally
cd ../hugo-site && hugo server -D
```

## Test Types

### Unit Tests (In Progress)
- Article deduplication logic
- Balancing algorithm
- URL building
- Date formatting
- Jaccard similarity calculation

### Integration Tests (Future)
- RSS feed parsing (with fixtures)
- OpenAI API calls (mocked)
- GitHub API calls (mocked)
- End-to-end workflow

### Manual Smoke Tests (Current)
1. Trigger worker manually via POST
2. Check GitHub for new commit
3. Verify Hugo site builds
4. Review summary quality
5. Check source attribution
6. Verify article balance (Venezuelan vs International)
7. Check deduplication worked correctly

## Pre-Deployment Checklist
- [ ] Local worker test passes
- [ ] Hugo builds without errors
- [ ] Summary looks reasonable
- [ ] Sources are attributed correctly
- [ ] No sensitive data in output
- [ ] Check OpenAI usage/cost
- [ ] Verify article count matches expectations
- [ ] Check logs for errors/warnings
- [ ] Test cache purge functionality

## Test Data
- Use `tests/fixtures/` for sample RSS feeds
- Mock OpenAI responses for deterministic tests
- Keep test data minimal to avoid bloat

## Performance Testing
- Monitor worker execution time (<10s ideal)
- Check memory usage (stay under 128MB)
- Measure OpenAI token usage per summary
- Profile deduplication algorithm with large datasets

## Regression Testing
- Keep previous summaries for comparison
- Verify backward compatibility when changing config schema
- Test with various article counts (0, 1, 10, 20+)
