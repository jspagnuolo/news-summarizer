# Architecture

## System Overview

```
┌─────────────────┐
│  Cloudflare     │
│  Cron Trigger   │
│  (Daily 4AM UTC)│
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│   Cloudflare Worker (news-summarizer-worker)            │
│                                                          │
│  1. Fetch topics config from GitHub                     │
│  2. For each active topic:                              │
│     a. Fetch RSS feeds (Google News)                    │
│     b. Parse and filter articles                        │
│     c. Deduplicate similar articles                     │
│     d. Balance perspectives (min per feed)              │
│     e. Summarize with OpenAI (GPT-4o-mini)              │
│     f. Generate Hugo markdown                           │
│     g. Commit to GitHub                                 │
│  3. Purge Cloudflare cache                              │
└────────┬─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│  GitHub Repo    │─────▶│ Cloudflare Pages │
│  (Auto Deploy)  │      │  (hugo-site/)    │
└─────────────────┘      └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   Static Site    │
                         │ news.spagnuolo   │
                         │      .biz        │
                         └──────────────────┘
```

## Data Flow

### 1. Trigger (Daily Cron)
- Runs at 4:00 AM UTC daily
- Can also be manually triggered via POST to `/trigger` endpoint

### 2. Configuration Fetch
```
Worker → GitHub API → config/topics.json
```
- Fetches latest topic configuration
- Includes RSS feeds, queries, and settings

### 3. News Gathering (Per Topic)
```
For each RSS feed:
  Worker → Google News RSS → XML Response
  ↓
  Parse with fast-xml-parser
  ↓
  Filter by date (last 5 days)
  ↓
  Add metadata (language, region, feedType)
```

### 4. Article Processing
```
All Articles
  ↓
URL Deduplication (exact matches)
  ↓
Jaccard Similarity Deduplication (75% threshold)
  ↓
Sort by date (newest first)
  ↓
Balance Selection (min 5 per perspective, max 20 total)
```

### 5. AI Summarization
```
Balanced Articles
  ↓
Format into prompt (separated by perspective)
  ↓
OpenAI API (GPT-4o-mini)
  ↓
JSON Response:
  {
    venezuelanPerspective: {...},
    internationalPerspective: {...},
    keyDifferences: [...],
    overallSummary: "..."
  }
```

### 6. Content Generation
```
Summary + Articles
  ↓
Generate Hugo Markdown
  - Frontmatter (metadata)
  - Overall Summary (first)
  - International Perspective (second)
  - Venezuelan Perspective (third)
  - Key Differences (fourth)
  - Sources (last, with links)
```

### 7. Publishing
```
Markdown Content
  ↓
GitHub API (PUT /contents/...)
  ↓
GitHub Actions (auto-triggered)
  ↓
Hugo Build
  ↓
Deploy to Cloudflare Pages
  ↓
Cache Purge via Cloudflare API
```

## Component Details

### Cloudflare Worker
- **Runtime**: V8 isolate (Node.js compatible)
- **Memory**: < 100MB typical usage
- **Execution Time**: 15-20 seconds per run
- **Cost**: Free tier (unlimited requests)

### OpenAI Integration
- **Model**: GPT-4o-mini
- **Tokens per summary**: ~2,000-3,000
- **Cost per summary**: $0.02-0.06
- **Rate limit**: 3 retries with exponential backoff

### Google News RSS
- **No API key required**
- **Free tier**: No limits
- **Format**: RSS 2.0 XML
- **Rate limit**: None observed

### GitHub Integration
- **API**: REST API v3
- **Authentication**: Personal Access Token
- **Operations**: GET (config), PUT (commit)
- **Rate limit**: 5,000 requests/hour

### Hugo Static Site
- **Version**: v0.120+
- **Theme**: Custom
- **Build time**: < 1 minute
- **Hosting**: Cloudflare Pages (free)

## Security

### Secrets Management
All sensitive credentials stored as Cloudflare Worker secrets:
- Never committed to git
- Encrypted at rest
- Only accessible to worker at runtime

### API Access
- GitHub: Personal Access Token (repo scope only)
- OpenAI: API Key (project-scoped)
- Cloudflare: API Token (cache purge only)

### Content Security
- No user input processed
- All external data sanitized
- Markdown properly escaped
- No XSS vectors

## Cost Breakdown

### Monthly Costs (Estimated)
| Service | Usage | Cost |
|---------|-------|------|
| OpenAI API | ~30 summaries/month | $0.60 - $1.80 |
| Cloudflare Workers | 30 executions/month | $0.00 (free tier) |
| Cloudflare Pages | Unlimited | $0.00 (free tier) |
| GitHub | Unlimited commits | $0.00 (free tier) |
| Google News RSS | Unlimited | $0.00 (free) |
| **Total** | | **$0.60 - $1.80/month** |

### Cost Optimization
- Use GPT-4o-mini (cheapest model)
- Cache RSS feeds briefly during development
- Efficient deduplication algorithm (O(n²) but n is small)
- Single OpenAI call per topic
- No unnecessary API requests

## Scalability

### Current Limits
- Topics: 1 (Venezuela)
- Articles per topic: 20
- Summaries per day: 1
- Execution time: ~20 seconds

### Scaling Plan
- **Phase 2**: Add 2-3 more topics (Argentina, Cuba)
  - Impact: 3-4x cost (~$3-6/month)
  - Impact: Execution time ~60 seconds
- **Phase 3**: Add 10 topics
  - Impact: 10x cost (~$10-18/month)
  - Impact: May need to process in batches
- **Phase 4**: Multiple summaries per day
  - Impact: Linear cost increase
  - Impact: Consider caching strategies

### Performance Bottlenecks
1. **OpenAI API**: Slowest operation (~5-10 seconds per call)
2. **RSS Fetching**: ~1-2 seconds per feed
3. **GitHub API**: ~1 second per operation
4. **Deduplication**: O(n²) but fast with small n

### Optimization Opportunities
- Parallel RSS fetching (currently sequential)
- Batch OpenAI requests if multiple topics
- Cache RSS feeds (5-minute TTL)
- Optimize deduplication algorithm
- Use Workers KV for configuration caching

## Monitoring

### Health Checks
- Worker execution success/failure
- OpenAI token usage
- GitHub commit success
- Cache purge success

### Metrics to Track
- Execution time per run
- Cost per summary
- Article count per perspective
- Deduplication effectiveness
- Summary quality (manual review)

### Alerting (Future)
- Worker failures
- OpenAI rate limits
- Cost threshold exceeded ($10/month)
- No articles found for topic

## Disaster Recovery

### Backup Strategy
- All content in GitHub (version controlled)
- Hugo site rebuilds from git history
- Configuration in git (topics.json)

### Rollback Procedures
1. Revert git commit
2. Redeploy worker with `npx wrangler rollback`
3. Hugo site auto-rebuilds from git

### Data Loss Scenarios
- **Worker failure**: Retry next day, no data loss
- **GitHub API failure**: No commit, no data loss
- **OpenAI failure**: No summary, articles remain
- **Hugo build failure**: Previous version remains live
