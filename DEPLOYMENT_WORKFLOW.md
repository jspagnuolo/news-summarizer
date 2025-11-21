# Deployment Workflow

This document outlines the deployment process for the News Summarizer system.

## Pre-Deployment Checklist

- [ ] All unit tests pass (`npm test` in `worker/`)
- [ ] Local Hugo preview looks correct (`hugo server -D` in `hugo-site/`)
- [ ] Changes are committed to a feature branch
- [ ] Code has been reviewed

## Deployment Steps

### 1. Test Locally

```bash
# Run unit tests
cd worker/
npm test

# Preview Hugo site
cd ../hugo-site/
hugo server -D
# Visit http://localhost:1313
```

### 2. Commit Changes

```bash
# From project root
git add .
git commit -m "Add dynamic perspectives and new topics"
git push origin main
```

> **Note**: Pushing to GitHub automatically triggers Cloudflare Pages to rebuild the Hugo site.

### 3. Deploy Worker to Cloudflare

```bash
cd worker/
npm run deploy
```

This updates the Cloudflare Worker with your latest code changes.

### 4. Verify Deployment

**Cloudflare Pages (Hugo Site)**:
1. Go to [Cloudflare Pages Dashboard](https://dash.cloudflare.com/)
2. Select your project
3. Check that the latest deployment succeeded
4. Visit your live site to verify

**Cloudflare Worker**:
1. Go to [Cloudflare Workers Dashboard](https://dash.cloudflare.com/)
2. Select your worker
3. Check deployment timestamp
4. Optionally trigger a manual run (see below)

### 5. Manual Worker Trigger (Optional)

To test the worker immediately without waiting for the cron schedule:

1. Go to Cloudflare Workers Dashboard
2. Click on your worker
3. Go to "Triggers" tab
4. Click "Send Test Event" or use the "Quick Edit" to trigger a scheduled event

Alternatively, use `wrangler`:
```bash
cd worker/
npx wrangler dev
# Then trigger via HTTP request or cron simulation
```

## Rollback Procedures

### Rollback Worker

**Option 1: Redeploy Previous Version**
```bash
git checkout <previous-commit>
cd worker/
npm run deploy
git checkout main  # Return to current branch
```

**Option 2: Cloudflare Dashboard**
1. Go to Cloudflare Workers Dashboard
2. Click on your worker
3. Go to "Deployments" tab
4. Click "Rollback" on a previous deployment

### Rollback Hugo Site

1. Go to Cloudflare Pages Dashboard
2. Select your project
3. Go to "Deployments" tab
4. Find the previous working deployment
5. Click "Rollback to this deployment"

### Rollback Git Changes

```bash
# Revert last commit
git revert HEAD
git push origin main

# Or reset to specific commit (use with caution)
git reset --hard <commit-hash>
git push origin main --force
```

## Monitoring

After deployment, monitor:

- **Worker Logs**: Cloudflare Workers Dashboard → Your Worker → Logs
- **Pages Build Logs**: Cloudflare Pages Dashboard → Your Project → Deployments → View Build
- **GitHub Actions**: Check if any automated workflows failed
- **Live Site**: Verify new summaries appear correctly

## Scheduled Worker Runs

The worker runs automatically based on the cron schedule in `wrangler.toml`:

```toml
[triggers]
crons = ["0 */6 * * *"]  # Every 6 hours
```

To change the schedule, edit `wrangler.toml` and redeploy the worker.

## Troubleshooting

### Worker Deployment Fails

```bash
# Check wrangler authentication
npx wrangler whoami

# Re-authenticate if needed
npx wrangler login

# Try deploying again
npm run deploy
```

### Hugo Build Fails

```bash
# Test build locally
cd hugo-site/
hugo --gc --minify

# Check Cloudflare Pages build logs for errors
```

### Worker Runs But Fails

1. Check Cloudflare Worker logs for errors
2. Verify environment variables are set correctly
3. Test locally with `npm run dev`
4. Check GitHub token permissions

## Cost Monitoring

- **OpenAI API**: Monitor usage at [OpenAI Dashboard](https://platform.openai.com/usage)
- **Cloudflare Workers**: Free tier covers most usage
- **Cloudflare Pages**: Free tier covers most usage

Set up billing alerts in each service to avoid unexpected charges.
