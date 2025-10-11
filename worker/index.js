/**
 * News Summarizer Cloudflare Worker
 *
 * This worker runs daily via cron trigger to:
 * 1. Fetch news articles for configured topics
 * 2. Summarize them using OpenAI
 * 3. Generate Hugo markdown files
 * 4. Commit and push to GitHub
 */

import OpenAI from 'openai';
import NewsAPI from 'newsapi';

// ============================================================================
// CONFIGURATION & UTILITIES
// ============================================================================

/**
 * Fetches the topics configuration from GitHub
 */
async function fetchTopicsConfig(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/config/topics.json`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'News-Summarizer-Worker'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch topics config: ${response.statusText}`);
  }

  const data = await response.json();
  const content = atob(data.content);
  return JSON.parse(content);
}

/**
 * Formats a date as YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Retry logic for API calls
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, i);
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms. Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ============================================================================
// NEWS FETCHING
// ============================================================================

/**
 * Fetches news articles for a specific topic
 */
async function fetchNewsForTopic(topic, newsapi, settings) {
  console.log(`Fetching news for topic: ${topic.name}`);

  const today = new Date();
  const fromDate = new Date(today);

  // Parse articleMaxAge (e.g., "7d" = 7 days)
  const maxAgeDays = parseInt(settings.articleMaxAge || '7d');
  fromDate.setDate(fromDate.getDate() - maxAgeDays);

  try {
    const response = await retryWithBackoff(async () => {
      return await newsapi.v2.everything({
        q: topic.query,
        language: topic.language || 'en',
        sortBy: topic.sortBy || 'publishedAt',
        from: formatDate(fromDate),
        to: formatDate(today),
        pageSize: settings.maxArticlesPerTopic || 10,
        sources: topic.sources?.length > 0 ? topic.sources.join(',') : undefined,
        domains: topic.excludeDomains?.length > 0 ? undefined : undefined,
        excludeDomains: topic.excludeDomains?.length > 0 ? topic.excludeDomains.join(',') : undefined
      });
    });

    if (response.status === 'ok' && response.articles?.length > 0) {
      console.log(`Found ${response.articles.length} articles for ${topic.name}`);
      return response.articles;
    } else {
      console.log(`No articles found for ${topic.name}`);
      return [];
    }
  } catch (error) {
    console.error(`Error fetching news for ${topic.name}:`, error.message);
    throw error;
  }
}

// ============================================================================
// AI SUMMARIZATION
// ============================================================================

/**
 * Summarizes news articles using OpenAI with structured outputs
 */
async function summarizeArticles(articles, topic, openai) {
  console.log(`Summarizing ${articles.length} articles for ${topic.name}`);

  // Prepare article data for the AI
  const articlesText = articles.map((article, idx) => {
    return `Article ${idx + 1}:
Title: ${article.title}
Source: ${article.source.name}
Published: ${article.publishedAt}
Description: ${article.description || 'N/A'}
URL: ${article.url}
---`;
  }).join('\n\n');

  const prompt = `You are a professional news analyst. Analyze and summarize the following news articles about ${topic.name}.

${articlesText}

Provide your response in the following JSON format:
{
  "bulletPoints": ["point 1", "point 2", "point 3", ...],
  "narrativeSummary": "2-3 paragraph narrative summary"
}

Requirements:
- Bullet points: Extract 5-8 key highlights from the articles
- Narrative summary: Write a cohesive 2-3 paragraph summary that synthesizes the main themes and developments
- Focus on facts and important developments
- Maintain a neutral, journalistic tone
- If articles present conflicting information, acknowledge this`;

  try {
    const response = await retryWithBackoff(async () => {
      return await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional news analyst who creates concise, accurate summaries of current events.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000
      });
    });

    const summary = JSON.parse(response.choices[0].message.content);
    console.log(`Successfully summarized articles for ${topic.name}`);
    return summary;
  } catch (error) {
    console.error(`Error summarizing articles for ${topic.name}:`, error.message);
    throw error;
  }
}

// ============================================================================
// HUGO MARKDOWN GENERATION
// ============================================================================

/**
 * Generates a Hugo markdown file from the summary
 */
function generateHugoMarkdown(topic, articles, summary, date) {
  const sources = [...new Set(articles.map(a => a.source.name))];
  const dateStr = formatDate(date);

  const frontMatter = `---
title: "${topic.name} News - ${dateStr}"
date: ${date.toISOString()}
topic: ${topic.id}
topicName: "${topic.name}"
sources: [${sources.map(s => `"${s}"`).join(', ')}]
articleCount: ${articles.length}
draft: false
---

`;

  const bulletPointsSection = `## Key Highlights

${summary.bulletPoints.map(point => `- ${point}`).join('\n')}

`;

  const narrativeSection = `## Summary

${summary.narrativeSummary}

`;

  const sourcesSection = `## Sources

This summary is based on ${articles.length} article${articles.length !== 1 ? 's' : ''} from the following sources:

${articles.map((article, idx) => {
    return `${idx + 1}. [${article.title}](${article.url}) - ${article.source.name} (${new Date(article.publishedAt).toLocaleDateString()})`;
  }).join('\n')}
`;

  return frontMatter + bulletPointsSection + narrativeSection + sourcesSection;
}

// ============================================================================
// GITHUB INTEGRATION
// ============================================================================

/**
 * Gets the SHA of a file if it exists in the repository
 */
async function getFileSHA(path, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'News-Summarizer-Worker'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.sha;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Commits a file to GitHub
 */
async function commitToGitHub(path, content, message, env) {
  console.log(`Committing file: ${path}`);

  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;

  // Check if file exists and get its SHA
  const existingSha = await getFileSHA(path, env);

  const body = {
    message: message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: env.GITHUB_BRANCH || 'main'
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'News-Summarizer-Worker',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to commit file: ${response.statusText} - ${errorText}`);
  }

  console.log(`Successfully committed: ${path}`);
  return await response.json();
}

// ============================================================================
// MAIN WORKFLOW
// ============================================================================

/**
 * Processes a single topic: fetch news, summarize, generate markdown, commit
 */
async function processTopic(topic, newsapi, openai, env, date) {
  console.log(`\n========================================`);
  console.log(`Processing topic: ${topic.name}`);
  console.log(`========================================`);

  try {
    // Step 1: Fetch news articles
    const articles = await fetchNewsForTopic(
      topic,
      newsapi,
      env.topicsConfig.settings
    );

    if (articles.length === 0) {
      console.log(`No articles found for ${topic.name}. Skipping.`);
      return { success: true, skipped: true, topic: topic.name };
    }

    // Step 2: Summarize articles using OpenAI
    const summary = await summarizeArticles(articles, topic, openai);

    // Step 3: Generate Hugo markdown
    const markdown = generateHugoMarkdown(topic, articles, summary, date);

    // Step 4: Commit to GitHub
    const dateStr = formatDate(date);
    const filePath = `hugo-site/content/summaries/${topic.id}/${dateStr}.md`;
    const commitMessage = `Add ${topic.name} news summary for ${dateStr}`;

    await commitToGitHub(filePath, markdown, commitMessage, env);

    console.log(`✓ Successfully processed ${topic.name}`);
    return { success: true, topic: topic.name, articlesCount: articles.length };

  } catch (error) {
    console.error(`✗ Failed to process ${topic.name}:`, error.message);
    return { success: false, topic: topic.name, error: error.message };
  }
}

/**
 * Main cron handler
 */
async function handleScheduled(event, env) {
  console.log('========================================');
  console.log('News Summarizer Worker - Starting');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('========================================\n');

  const results = {
    timestamp: new Date().toISOString(),
    topics: [],
    success: 0,
    failed: 0,
    skipped: 0
  };

  try {
    // Initialize APIs
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });

    const newsapi = new NewsAPI(env.NEWS_API_KEY);

    // Fetch topics configuration
    console.log('Fetching topics configuration...');
    const topicsConfig = await fetchTopicsConfig(env);
    env.topicsConfig = topicsConfig; // Store for later use

    const activeTopics = topicsConfig.topics.filter(t => t.active);
    console.log(`Found ${activeTopics.length} active topics to process\n`);

    // Process each topic
    const date = new Date();
    for (const topic of activeTopics) {
      const result = await processTopic(topic, newsapi, openai, env, date);
      results.topics.push(result);

      if (result.success) {
        if (result.skipped) {
          results.skipped++;
        } else {
          results.success++;
        }
      } else {
        results.failed++;
      }

      // Add a small delay between topics to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n========================================');
    console.log('News Summarizer Worker - Complete');
    console.log(`Successful: ${results.success}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Failed: ${results.failed}`);
    console.log('========================================');

    return results;

  } catch (error) {
    console.error('Critical error in scheduled handler:', error);
    throw error;
  }
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
  /**
   * Cron trigger handler
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  },

  /**
   * HTTP handler (for manual testing)
   */
  async fetch(request, env, ctx) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/trigger') {
      // Allow manual triggering via POST request for testing
      const results = await handleScheduled({}, env);
      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('News Summarizer Worker is running. Use cron trigger or POST to /trigger for manual execution.', {
      status: 200
    });
  }
};
