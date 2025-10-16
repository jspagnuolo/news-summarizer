# News Summarizer - Project Context

## Purpose
Automated news aggregation system comparing inside/outside perspectives on global events.

## Current Features
- Daily automated news gathering via Cloudflare Workers cron
- Multi-perspective summaries (Venezuelan sources vs International sources)
- AI-powered summarization with OpenAI
- Static site generation with Hugo
- Comparison of key coverage differences
- Source attribution
- Per-feed query customization
- Article deduplication and balancing

## Architecture
- **Cloudflare Worker**: Scheduled automation (cron), RSS fetching, OpenAI integration
- **Hugo Static Site**: Content display, deployed to Cloudflare Pages
- **GitHub**: Version control, automated deployments
- **Google News RSS**: Primary news source (no API key required)
- **OpenAI API**: Summarization and perspective comparison

## Current Topics
- Venezuela (Spanish/Venezuelan sources vs English/US sources)

## Tech Stack
- Node.js 20+
- Cloudflare Workers (serverless)
- Hugo static site generator
- OpenAI API (GPT-4o-mini)
- Google News RSS feeds
- fast-xml-parser for RSS parsing

## Cost Structure
- OpenAI: ~$0.02-0.06 per daily summary
- Cloudflare Workers: Free tier (well within limits)
- Cloudflare Pages: Free
- Google News RSS: Free
- Monthly estimated cost: $1-2

## Development Status
Active development. Recently implemented per-feed queries, article balancing, and deduplication.
Next phase: code restructuring, testing infrastructure, and documentation.

## Key Files
- `worker/index.js`: Main worker logic
- `config/topics.json`: Topic configuration
- `hugo-site/`: Static site content and themes
- `wrangler.toml`: Worker configuration
