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
import { XMLParser } from 'fast-xml-parser';

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
// NEWS FETCHING (Google News RSS)
// ============================================================================

/**
 * Builds Google News RSS feed URL
 */
function buildGoogleNewsUrl(query, language, region) {
  const params = new URLSearchParams({
    q: query,
    hl: `${language}-${region}`,
    gl: region,
    ceid: `${region}:${language}`
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
}

/**
 * Parses Google News RSS feed and returns articles with metadata
 */
async function parseRSSFeed(url, language, region) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'News-Summarizer-Worker/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.statusText}`);
  }

  const xmlText = await response.text();
  const parsed = parser.parse(xmlText);

  if (!parsed.rss || !parsed.rss.channel || !parsed.rss.channel.item) {
    return [];
  }

  const items = Array.isArray(parsed.rss.channel.item)
    ? parsed.rss.channel.item
    : [parsed.rss.channel.item];

  // Determine feed type based on language and region
  const feedType = (language === 'es' && region === 'VE') ? 'venezuelan' : 'international';

  return items.map(item => {
    // Extract source from title (Google News format: "Article Title - Source Name")
    const titleParts = item.title?.split(' - ') || [];
    const source = titleParts.length > 1 ? titleParts[titleParts.length - 1] : 'Google News';
    const title = titleParts.length > 1 ? titleParts.slice(0, -1).join(' - ') : item.title;

    return {
      title: title || 'Untitled',
      url: item.link || '',
      publishedAt: item.pubDate || new Date().toISOString(),
      description: item.description || '',
      source: {
        name: source
      },
      metadata: {
        language: language,
        region: region,
        feedType: feedType
      }
    };
  });
}

/**
 * Fetches news articles for a specific topic using Google News RSS feeds
 */
async function fetchNewsForTopic(topic, settings) {
  console.log(`Fetching news for topic: ${topic.name}`);

  const allArticles = [];
  const maxArticles = settings.maxArticlesPerTopic || 10;
  const maxAgeDays = parseInt(settings.articleMaxAge || '7d');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  try {
    // Fetch from each RSS feed configured for the topic
    for (const feed of topic.rssFeeds || []) {
      if (feed.type !== 'google_news') continue;

      try {
        const url = buildGoogleNewsUrl(topic.query, feed.language, feed.region);
        console.log(`Fetching feed: ${url}`);

        const articles = await retryWithBackoff(async () => {
          return await parseRSSFeed(url, feed.language, feed.region);
        });

        // Filter by date and add to collection
        const recentArticles = articles.filter(article => {
          const pubDate = new Date(article.publishedAt);
          return pubDate >= cutoffDate;
        });

        console.log(`Found ${recentArticles.length} recent articles from ${feed.language}-${feed.region} feed`);
        allArticles.push(...recentArticles);

      } catch (error) {
        console.error(`Failed to fetch ${feed.language}-${feed.region} feed: ${error.message}`);
        // Continue with other feeds
      }
    }

    // Remove duplicates by URL
    const uniqueArticles = Array.from(
      new Map(allArticles.map(a => [a.url, a])).values()
    );

    // Sort by date (newest first) and limit
    const sortedArticles = uniqueArticles
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, maxArticles);

    console.log(`Total unique articles after filtering: ${sortedArticles.length}`);
    return sortedArticles;

  } catch (error) {
    console.error(`Error fetching news for ${topic.name}:`, error.message);
    throw error;
  }
}

// ============================================================================
// AI SUMMARIZATION
// ============================================================================

/**
 * Summarizes news articles using OpenAI with perspective-based structure
 */
async function summarizeArticles(articles, topic, openai) {
  console.log(`Summarizing ${articles.length} articles for ${topic.name}`);

  // Separate articles by perspective
  const venezuelanArticles = articles.filter(a => a.metadata?.feedType === 'venezuelan');
  const internationalArticles = articles.filter(a => a.metadata?.feedType === 'international');

  console.log(`Venezuelan sources: ${venezuelanArticles.length}, International sources: ${internationalArticles.length}`);

  // Format Venezuelan articles
  const venezuelanText = venezuelanArticles.length > 0
    ? venezuelanArticles.map((article, idx) => {
        return `Article ${idx + 1}:
Title: ${article.title}
Source: ${article.source.name}
Published: ${article.publishedAt}
Description: ${article.description || 'N/A'}
---`;
      }).join('\n\n')
    : 'No Venezuelan sources available';

  // Format international articles
  const internationalText = internationalArticles.length > 0
    ? internationalArticles.map((article, idx) => {
        return `Article ${idx + 1}:
Title: ${article.title}
Source: ${article.source.name}
Published: ${article.publishedAt}
Description: ${article.description || 'N/A'}
---`;
      }).join('\n\n')
    : 'No international sources available';

  const prompt = `You are a professional news analyst. Analyze and summarize news about ${topic.name} from two different regional perspectives.

VENEZUELAN SOURCES (Spanish-language, from inside Venezuela):
${venezuelanText}

INTERNATIONAL SOURCES (English-language, international media):
${internationalText}

Provide your response in the following JSON format:
{
  "venezuelanPerspective": {
    "bulletPoints": ["point 1", "point 2", ...],
    "summary": "2-3 sentence summary of Venezuelan sources"
  },
  "internationalPerspective": {
    "bulletPoints": ["point 1", "point 2", ...],
    "summary": "2-3 sentence summary of international sources"
  },
  "keyDifferences": ["difference 1", "difference 2", ...],
  "overallSummary": "2-3 paragraph synthesis of both perspectives"
}

Requirements:
- Venezuelan perspective: Summarize what Spanish-language Venezuelan sources are reporting. Note: Some articles may be in Spanish - extract the key information.
- International perspective: Summarize what international/English sources are reporting
- Key differences: Identify 2-4 notable differences in coverage, emphasis, or framing between the two perspectives
- Overall summary: Synthesize both perspectives into a coherent narrative
- Maintain neutrality - present both perspectives fairly
- If perspectives conflict, acknowledge this explicitly
- If one perspective has no sources, note this and focus on available sources
- All output must be in English (translate Spanish content as needed)`;

  try {
    const response = await retryWithBackoff(async () => {
      return await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional news analyst who creates concise, accurate summaries comparing different regional perspectives on current events.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 3000
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
 * Generates a Hugo markdown file from the perspective-based summary
 */
function generateHugoMarkdown(topic, articles, summary, date) {
  const sources = [...new Set(articles.map(a => a.source.name))];
  const dateStr = formatDate(date);

  // Count articles by perspective
  const venezuelanArticles = articles.filter(a => a.metadata?.feedType === 'venezuelan');
  const internationalArticles = articles.filter(a => a.metadata?.feedType === 'international');

  const frontMatter = `---
title: "${topic.name} News - ${dateStr}"
date: ${date.toISOString()}
topic: ${topic.id}
topicName: "${topic.name}"
sources: [${sources.map(s => `"${s}"`).join(', ')}]
articleCount: ${articles.length}
venezuelanSources: ${venezuelanArticles.length}
internationalSources: ${internationalArticles.length}
draft: false
---

`;

  // Venezuelan Perspective Section
  const venezuelanSection = venezuelanArticles.length > 0
    ? `## Inside Venezuela (Venezuelan Sources)

### Key Points

${summary.venezuelanPerspective?.bulletPoints?.map(point => `- ${point}`).join('\n') || '- No key points available'}

${summary.venezuelanPerspective?.summary || 'No Venezuelan sources available for this summary.'}

`
    : `## Inside Venezuela (Venezuelan Sources)

No Venezuelan sources available for this time period.

`;

  // International Perspective Section
  const internationalSection = internationalArticles.length > 0
    ? `## International Perspective

### Key Points

${summary.internationalPerspective?.bulletPoints?.map(point => `- ${point}`).join('\n') || '- No key points available'}

${summary.internationalPerspective?.summary || 'No international sources available for this summary.'}

`
    : `## International Perspective

No international sources available for this time period.

`;

  // Key Differences Section
  const differencesSection = summary.keyDifferences && summary.keyDifferences.length > 0
    ? `## Key Differences in Coverage

${summary.keyDifferences.map(diff => `- ${diff}`).join('\n')}

`
    : '';

  // Overall Summary Section
  const overallSection = `## Overall Summary

${summary.overallSummary || 'Unable to generate overall summary.'}

`;

  // Sources Section with language/region tags
  const sourcesSection = `## Sources

This summary is based on ${articles.length} article${articles.length !== 1 ? 's' : ''} from the following sources:

${articles.map((article, idx) => {
    const lang = article.metadata?.language || 'unknown';
    const region = article.metadata?.region || 'unknown';
    const tag = `[${lang}-${region}]`;
    return `${idx + 1}. ${tag} [${article.title}](${article.url}) - ${article.source.name} (${new Date(article.publishedAt).toLocaleDateString()})`;
  }).join('\n')}
`;

  return frontMatter + venezuelanSection + internationalSection + differencesSection + overallSection + sourcesSection;
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
// CLOUDFLARE CACHE PURGING
// ============================================================================

/**
 * Purges Cloudflare cache for news.spagnuolo.biz only
 */
async function purgeCloudflareCache(env) {
  console.log('Purging Cloudflare cache for news.spagnuolo.biz...');

  // If CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are not set, skip cache purge
  if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
    console.log('⚠️  Cache purge skipped - CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not configured');
    return { success: false, skipped: true };
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prefixes: ['news.spagnuolo.biz/']
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to purge cache: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    console.log('✓ Successfully purged Cloudflare cache for news.spagnuolo.biz');
    return { success: true, result };

  } catch (error) {
    console.error(`✗ Failed to purge cache: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// MAIN WORKFLOW
// ============================================================================

/**
 * Processes a single topic: fetch news, summarize, generate markdown, commit
 */
async function processTopic(topic, openai, env, date) {
  console.log(`\n========================================`);
  console.log(`Processing topic: ${topic.name}`);
  console.log(`========================================`);

  try {
    // Step 1: Fetch news articles
    const articles = await fetchNewsForTopic(
      topic,
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

    // Fetch topics configuration
    console.log('Fetching topics configuration...');
    const topicsConfig = await fetchTopicsConfig(env);
    env.topicsConfig = topicsConfig; // Store for later use

    const activeTopics = topicsConfig.topics.filter(t => t.active);
    console.log(`Found ${activeTopics.length} active topics to process\n`);

    // Process each topic
    const date = new Date();
    for (const topic of activeTopics) {
      const result = await processTopic(topic, openai, env, date);
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

    // Purge Cloudflare cache if any summaries were successfully created
    if (results.success > 0) {
      console.log('\n');
      const cacheResult = await purgeCloudflareCache(env);
      results.cachePurge = cacheResult;
    }

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
