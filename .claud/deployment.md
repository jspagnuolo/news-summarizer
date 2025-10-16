# Deployment Guide

## Prerequisites
- Node.js 20+
- Wrangler CLI (npx wrangler)
- Hugo installed
- GitHub repo with write access
- OpenAI API key
- Cloudflare account

## Environment Variables

### Cloudflare Worker Secrets
```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put CLOUDFLARE_ZONE_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

### Cloudflare Worker Variables (wrangler.toml)
- GITHUB_OWNER
- GITHUB_REPO

## Deployment Steps

### 1. Local Testing
```bash
cd worker
npm install
npx wrangler dev --local
# Test at http://localhost:8787/trigger
```

### 2. Deploy Worker
```bash
cd worker
npx wrangler deploy
```

### 3. Test Production Worker
```bash
curl -X POST https://news-summarizer-worker.digitalimages.workers.dev/trigger
```

### 4. Verify Hugo Site
- Check https://news.spagnuolo.biz
- Verify new summary appears
- Check sources are displayed
- Test mobile responsiveness
- Verify cache was purged

## Monitoring
- Check Cloudflare Worker logs: `npx wrangler tail`
- Monitor OpenAI usage dashboard
- Check GitHub Actions (if enabled)
- Review Hugo build logs on Cloudflare Pages
- Set up alerts for failures

## Rollback Procedure
```bash
# Revert git commit
git revert HEAD
git push origin main

# Redeploy previous worker version
cd worker
npx wrangler rollback
```

## Troubleshooting

### Worker fails to deploy
- Check wrangler.toml syntax
- Verify all secrets are set
- Check Node.js version compatibility

### Summaries not appearing
- Check GitHub commit succeeded
- Verify Cloudflare Pages deployed
- Check cache purge logs
- Manually purge cache if needed

### OpenAI errors
- Verify API key is valid
- Check account has credits
- Review rate limit errors
- Check prompt size isn't too large

### RSS feed errors
- Verify Google News RSS is accessible
- Check query syntax
- Try different regions/languages
- Look for rate limiting

## Production URLs
- Worker: https://news-summarizer-worker.digitalimages.workers.dev
- Site: https://news.spagnuolo.biz
- GitHub: https://github.com/jspagnuolo/news-summarizer
