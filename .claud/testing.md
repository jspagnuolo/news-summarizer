# Testing Strategy

## Local Testing

### Option 1: Test Against Production (Recommended)
```bash
# Use production worker with manual trigger
curl -X POST https://news-summarizer-worker.digitalimages.workers.dev/trigger
```

### Option 2: Local Development (Wrangler Limitations)
Wrangler v3 doesn't automatically read `.env` files. For full local testing, use Wrangler secrets or test against production.

```bash
# Install dependencies
cd worker && npm install

# For quick local server (just checks worker loads):
npx wrangler dev --local

# Test basic endpoint
curl http://localhost:8787/

# Note: /trigger endpoint requires secrets to be set in Cloudflare
# For full testing, use production trigger or Wrangler v4+
```

### Option 3: Hugo Site Local Testing
```bash
cd hugo-site && hugo server -D
# Visit http://localhost:1313
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
