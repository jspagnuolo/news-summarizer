# News Summarizer

An automated daily news summarization system that fetches news articles, summarizes them using AI, and publishes to a static website.

## Overview

This system automatically:
1. **Fetches** news articles daily using NewsAPI
2. **Summarizes** them using OpenAI (GPT-4)
3. **Generates** Hugo markdown files organized by topic
4. **Commits** summaries to GitHub
5. **Deploys** to Cloudflare Pages automatically

## Topics Currently Tracked
- Venezuela (more can be easily added via configuration)

## Tech Stack
- **Cloudflare Workers** - Cron-triggered automation
- **OpenAI API** - AI-powered summarization
- **NewsAPI** - News article fetching
- **Hugo** - Static site generator
- **Cloudflare Pages** - Hosting and deployment
- **GitHub API** - Automated commits

## Project Structure

```
news-summarizer/
├── config/
│   └── topics.json              # Topics configuration (easy to edit!)
├── worker/
│   ├── index.js                 # Cloudflare Worker code
│   ├── package.json             # Worker dependencies
│   └── wrangler.toml            # Cloudflare Worker config
├── hugo-site/
│   ├── hugo.toml                # Hugo configuration
│   ├── content/
│   │   ├── summaries/           # Generated summaries (by topic)
│   │   ├── topics/              # Topics page
│   │   └── archive/             # Archive page
│   └── themes/
│       └── news-theme/          # Custom Hugo theme
├── .env.example                 # Environment variables template
└── README.md                    # This file
```

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- Hugo (install from https://gohugo.io/installation/)
- Cloudflare account (free tier works)
- OpenAI API key
- NewsAPI key (free tier: 100 requests/day)
- GitHub account and personal access token

### Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yourusername/news-summarizer.git
cd news-summarizer

# Install worker dependencies
cd worker
npm install
cd ..
```

### Step 2: Configure API Keys and Secrets

1. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Get your API keys:**
   - **OpenAI API Key**: https://platform.openai.com/api-keys
   - **NewsAPI Key**: https://newsapi.org/register
   - **GitHub Personal Access Token**:
     - Go to GitHub Settings > Developer Settings > Personal Access Tokens > Tokens (classic)
     - Create a token with `repo` scope (full control of private repositories)

3. **Edit `.env` file with your actual keys:**
   ```
   OPENAI_API_KEY=sk-proj-your-actual-key-here
   NEWS_API_KEY=your-newsapi-key-here
   GITHUB_TOKEN=ghp_your-github-token-here
   GITHUB_REPO_OWNER=your-github-username
   GITHUB_REPO_NAME=news-summarizer
   GITHUB_BRANCH=main
   ```

   **⚠️ IMPORTANT:** Never commit the `.env` file! It's in `.gitignore` for safety.

### Step 3: Set Up Cloudflare Worker

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare:**
   ```bash
   wrangler login
   ```

3. **Configure secrets in Cloudflare:**
   ```bash
   cd worker

   # Set each secret (you'll be prompted to enter the value)
   wrangler secret put OPENAI_API_KEY
   wrangler secret put NEWS_API_KEY
   wrangler secret put GITHUB_TOKEN
   wrangler secret put GITHUB_REPO_OWNER
   wrangler secret put GITHUB_REPO_NAME
   wrangler secret put GITHUB_BRANCH
   ```

4. **Deploy the worker:**
   ```bash
   wrangler deploy
   ```

5. **The worker is now deployed!** It will run automatically at 9 AM UTC daily.

### Step 4: Set Up Cloudflare Pages

1. **Push your repository to GitHub:**
   ```bash
   git add .
   git commit -m "Initial setup"
   git push origin main
   ```

2. **In Cloudflare Dashboard:**
   - Go to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**
   - Select your `news-summarizer` repository
   - Configure build settings:
     - **Build command:** `cd hugo-site && hugo --minify`
     - **Build output directory:** `hugo-site/public`
     - **Root directory:** `/`

3. **Deploy!** Cloudflare Pages will build and deploy your site.

4. **Enable automatic deployments:**
   - Cloudflare Pages will automatically rebuild when you push to your repository
   - When the worker commits new summaries, the site will auto-update!

### Step 5: Test the System

#### Test the Worker Manually

You can trigger the worker manually for testing:

```bash
cd worker
curl -X POST https://your-worker-name.your-subdomain.workers.dev/trigger
```

Or use Wrangler:
```bash
wrangler tail  # View live logs
```

#### Test Hugo Site Locally

```bash
cd hugo-site
hugo server -D
```

Visit http://localhost:1313 to preview your site.

## How to Add New Topics

Adding a new topic is simple - just edit the `config/topics.json` file!

### Example: Adding "AI Technology" topic

Edit `config/topics.json`:

```json
{
  "topics": [
    {
      "id": "venezuela",
      "name": "Venezuela",
      "query": "Venezuela OR Maduro OR \"Venezuelan government\"",
      "active": true,
      "sources": [],
      "excludeDomains": [],
      "language": "en",
      "sortBy": "publishedAt"
    },
    {
      "id": "ai-technology",
      "name": "AI Technology",
      "query": "\"artificial intelligence\" OR \"machine learning\" OR \"large language models\"",
      "active": true,
      "sources": [],
      "excludeDomains": [],
      "language": "en",
      "sortBy": "publishedAt"
    }
  ],
  "settings": {
    "maxArticlesPerTopic": 10,
    "maxRequestsPerDay": 100,
    "articleMaxAge": "7d"
  }
}
```

### Topic Configuration Fields

- **`id`**: Unique identifier (lowercase, use hyphens, no spaces)
- **`name`**: Display name shown on the website
- **`query`**: NewsAPI search query (use OR for multiple terms, quotes for phrases)
- **`active`**: Set to `false` to temporarily disable a topic
- **`sources`**: Array of specific news sources (e.g., `["bbc-news", "cnn"]`)
- **`excludeDomains`**: Domains to exclude (e.g., `["example.com"]`)
- **`language`**: Two-letter language code (default: `"en"`)
- **`sortBy`**: Sort order: `"publishedAt"`, `"relevancy"`, or `"popularity"`

### Commit and Push Changes

```bash
git add config/topics.json
git commit -m "Add AI Technology topic"
git push origin main
```

The worker will automatically pick up the new topic on its next run!

## API Rate Limits & Considerations

### NewsAPI Free Tier Limits
- **100 requests per day** across ALL topics
- Plan accordingly: 5 topics = ~20 requests per topic per day max
- Articles from last 1 month only on free tier

### OpenAI API Costs
- Uses `gpt-4o-mini` model (cost-effective)
- Approximately $0.01-0.05 per summary
- Set up billing alerts in OpenAI dashboard

### Rate Limit Strategy
- Worker processes topics sequentially with 2-second delays
- Handles failures gracefully (one topic failure won't stop others)
- Consider upgrading NewsAPI or reducing topics if hitting limits

## Troubleshooting

### Worker isn't running

1. Check Cloudflare Workers dashboard for errors
2. View logs: `wrangler tail`
3. Verify secrets are set: `wrangler secret list`
4. Test manually: `curl -X POST https://your-worker.workers.dev/trigger`

### No summaries appearing

1. Check if news articles were found (view worker logs)
2. Verify topics.json configuration is valid JSON
3. Check GitHub commits in your repository
4. Ensure Hugo site is building correctly on Cloudflare Pages

### API errors

1. **OpenAI errors**: Check API key and billing status
2. **NewsAPI errors**: Verify API key and check rate limits
3. **GitHub errors**: Ensure personal access token has `repo` scope

### Hugo site not updating

1. Check Cloudflare Pages build logs
2. Verify build command and output directory settings
3. Test locally: `cd hugo-site && hugo server`
4. Check that summaries are being committed to the repo

## Customization

### Change Cron Schedule

Edit `worker/wrangler.toml`:

```toml
[triggers]
crons = ["0 9 * * *"]  # 9 AM UTC daily
# Examples:
# "0 */6 * * *"   - Every 6 hours
# "0 9,17 * * *"  - 9 AM and 5 PM daily
# "0 9 * * 1-5"   - 9 AM weekdays only
```

### Customize Hugo Theme

- Edit CSS: `hugo-site/themes/news-theme/static/css/style.css`
- Edit layouts: `hugo-site/themes/news-theme/layouts/`
- Modify site config: `hugo-site/hugo.toml`

### Adjust Summary Format

Edit the OpenAI prompt in `worker/index.js` (look for the `summarizeArticles` function).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker (Cron: Daily 9 AM UTC)               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  1. Read topics.json from GitHub                 │   │
│  │  2. For each active topic:                       │   │
│  │     - Fetch articles (NewsAPI)                   │   │
│  │     - Summarize with AI (OpenAI)                 │   │
│  │     - Generate Hugo markdown                     │   │
│  │     - Commit to GitHub (GitHub API)              │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │   GitHub Repository    │
         │  - topics.json         │
         │  - hugo-site/content/  │
         └───────────┬────────────┘
                     │ (webhook)
                     ▼
         ┌───────────────────────┐
         │  Cloudflare Pages      │
         │  - Auto-build Hugo     │
         │  - Deploy static site  │
         └───────────────────────┘
```

## License

MIT License - feel free to use and modify!

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review Cloudflare Worker logs: `wrangler tail`
3. Open an issue on GitHub

## Credits

Built with:
- [OpenAI GPT-4](https://openai.com/)
- [NewsAPI](https://newsapi.org/)
- [Hugo](https://gohugo.io/)
- [Cloudflare Workers & Pages](https://www.cloudflare.com/)
