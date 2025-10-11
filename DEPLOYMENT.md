# Quick Deployment Guide

This is a condensed guide for deploying the News Summarizer system. For full details, see README.md.

## Prerequisites Checklist

- [ ] Node.js 18+ installed
- [ ] Hugo installed
- [ ] Cloudflare account created
- [ ] OpenAI API key obtained
- [ ] NewsAPI key obtained
- [ ] GitHub personal access token created (with `repo` scope)

## Quick Setup (5 Steps)

### 1. Install Dependencies

```bash
cd worker
npm install
cd ..
```

### 2. Configure Secrets

Copy `.env.example` to `.env` and fill in your actual API keys:

```bash
cp .env.example .env
# Edit .env with your actual keys
```

### 3. Deploy Worker

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler secret put OPENAI_API_KEY
wrangler secret put NEWS_API_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_BRANCH
wrangler deploy
# Note: GITHUB_OWNER and GITHUB_REPO are set in wrangler.toml [vars] section
cd ..
```

### 4. Push to GitHub

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

### 5. Setup Cloudflare Pages

1. Go to Cloudflare Dashboard > Workers & Pages > Create application > Pages
2. Connect to your GitHub repository
3. Build settings:
   - **Build command:** `cd hugo-site && hugo --minify`
   - **Build output directory:** `hugo-site/public`
   - **Root directory:** `/`
4. Click "Save and Deploy"

## Testing

### Test Worker Manually

```bash
# View worker logs
cd worker
wrangler tail

# Trigger manually
curl -X POST https://your-worker.workers.dev/trigger
```

### Test Hugo Site Locally

```bash
cd hugo-site
hugo server -D
# Visit http://localhost:1313
```

## Adding New Topics

1. Edit `config/topics.json`
2. Add new topic object with required fields
3. Commit and push:
   ```bash
   git add config/topics.json
   git commit -m "Add new topic"
   git push origin main
   ```

## Troubleshooting Quick Tips

**Worker not running?**
```bash
cd worker
wrangler tail  # Check logs
wrangler secret list  # Verify secrets are set
```

**Site not updating?**
- Check Cloudflare Pages build logs in dashboard
- Verify commits are appearing in GitHub
- Test Hugo build locally: `cd hugo-site && hugo`

**API errors?**
- OpenAI: Check billing and API key validity
- NewsAPI: Verify you're within free tier limits (100 req/day)
- GitHub: Ensure token has `repo` scope

## Environment Variables Reference

Required secrets for Cloudflare Worker:
- `OPENAI_API_KEY` - OpenAI API key
- `NEWS_API_KEY` - NewsAPI key
- `GITHUB_TOKEN` - GitHub personal access token
- `GITHUB_BRANCH` - Target branch (usually "main")

Note: `GITHUB_OWNER` and `GITHUB_REPO` are configured in `wrangler.toml` under the `[vars]` section, not as secrets.

## Cost Estimates (Free Tiers)

- **NewsAPI**: Free (100 requests/day)
- **Cloudflare Workers**: Free (100,000 requests/day)
- **Cloudflare Pages**: Free (500 builds/month, unlimited sites)
- **GitHub**: Free (unlimited public repos)
- **OpenAI**: Pay-as-you-go (~$0.01-0.05 per summary with gpt-4o-mini)

## Maintenance

Daily automated:
- Worker runs at 9 AM UTC via cron
- Fetches news for active topics
- Generates summaries
- Commits to GitHub
- Site auto-rebuilds via Cloudflare Pages

Manual maintenance:
- Monitor OpenAI costs
- Check for API errors in worker logs
- Add/remove topics as needed
- Adjust cron schedule if desired

## Support

See README.md for detailed documentation and troubleshooting.
