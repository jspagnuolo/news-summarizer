/**
 * News Summarizer Cloudflare Worker
 *
 * This worker runs daily via cron trigger to:
 * 1. Fetch news articles for configured topics
 * 2. Summarize them using OpenAI
 * 3. Generate Hugo markdown files
 * 4. Commit and push to GitHub
 */

import OpenAI from "openai";
import { XMLParser } from "fast-xml-parser";

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
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "News-Summarizer-Worker",
    },
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
  return date.toISOString().split("T")[0];
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
      console.log(
        `Retry ${i + 1}/${maxRetries} after ${delay}ms. Error: ${error.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Calculates Jaccard similarity between two strings based on word sets
 */
function jaccardSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  // Convert to lowercase and split into word sets
  const set1 = new Set(
    str1
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
  const set2 = new Set(
    str2
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );

  // Handle edge cases
  if (set1.size === 0 && set2.size === 0) return 1;
  if (set1.size === 0 || set2.size === 0) return 0;

  // Calculate intersection and union
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Removes duplicate or highly similar articles, preferring articles from underrepresented sources
 */
function deduplicateArticles(articles, threshold = 0.75) {
  if (!articles || articles.length === 0) return [];

  console.log(
    `🔍 Starting deduplication with ${articles.length} articles (threshold: ${threshold})`,
  );

  // Count articles by region to determine which sources are underrepresented
  const regionCounts = {};
  articles.forEach((article) => {
    const region = article.metadata?.region || "unknown";
    regionCounts[region] = (regionCounts[region] || 0) + 1;
  });

  const uniqueArticles = [];
  const duplicateInfo = [];

  for (const article of articles) {
    let isDuplicate = false;

    // Check similarity against all articles already in the unique set
    for (const uniqueArticle of uniqueArticles) {
      const similarity = jaccardSimilarity(article.title, uniqueArticle.title);

      if (similarity >= threshold) {
        isDuplicate = true;
        duplicateInfo.push({
          kept: uniqueArticle.title.substring(0, 50) + "...",
          duplicate: article.title.substring(0, 50) + "...",
          similarity: similarity.toFixed(2),
        });
        break;
      }
    }

    if (!isDuplicate) {
      uniqueArticles.push(article);
    }
  }

  if (duplicateInfo.length > 0) {
    console.log(
      `   Removed ${duplicateInfo.length} duplicate/similar article(s)`,
    );
    duplicateInfo.slice(0, 3).forEach((info) => {
      console.log(
        `   - Similarity ${info.similarity}: Kept "${info.kept}", removed "${info.duplicate}"`,
      );
    });
    if (duplicateInfo.length > 3) {
      console.log(`   - ... and ${duplicateInfo.length - 3} more`);
    }
  } else {
    console.log(`   No duplicates found`);
  }

  return uniqueArticles;
}

/**
 * Balances article selection to ensure fair representation from different perspectives
 */
function balanceArticleSelection(
  articles,
  maxArticles,
  minArticlesPerPerspective,
  topic
) {
  if (!articles || articles.length === 0) return [];

  // If no topic or perspectives defined, return simple slice
  if (!topic || !topic.perspectives) {
    return articles.slice(0, maxArticles);
  }

  const perspectives = topic.perspectives;
  const buckets = {};
  perspectives.forEach(p => buckets[p.id] = []);
  const otherArticles = [];

  // Sort articles into buckets
  for (const article of articles) {
    const pId = article.metadata?.perspective || article.metadata?.feedType;
    const perspective = perspectives.find(p => p.id === pId);

    if (perspective) {
      buckets[perspective.id].push(article);
    } else {
      otherArticles.push(article);
    }
  }

  console.log(`\n⚖️  Balancing article selection:`);
  perspectives.forEach(p => {
    console.log(`   ${p.name} articles: ${buckets[p.id].length}`);
  });
  if (otherArticles.length > 0) {
    console.log(`   Other articles: ${otherArticles.length}`);
  }

  // Check minimum requirements
  const minRequired = minArticlesPerPerspective || 0;
  if (minRequired > 0) {
    perspectives.forEach(p => {
      if (buckets[p.id].length < minRequired) {
        console.log(
          `   ⚠️  Only ${buckets[p.id].length} ${p.name} articles found (minimum: ${minRequired})`
        );
      }
    });
  }

  // Balance the selection
  // Target per perspective
  const targetPerPerspective = Math.floor(maxArticles / perspectives.length);
  let balanced = [];

  // 1. Take up to target from each perspective
  perspectives.forEach(p => {
    const selected = buckets[p.id].slice(0, targetPerPerspective);
    balanced.push(...selected);
  });

  // 2. If we have room, fill round-robin from perspectives that have extras
  if (balanced.length < maxArticles) {
    const extras = {};
    perspectives.forEach(p => {
      extras[p.id] = buckets[p.id].slice(targetPerPerspective);
    });

    let added = true;
    while (balanced.length < maxArticles && added) {
      added = false;
      for (const p of perspectives) {
        if (balanced.length >= maxArticles) break;
        if (extras[p.id].length > 0) {
          balanced.push(extras[p.id].shift());
          added = true;
        }
      }
    }
  }

  // 3. If still have room, add others
  if (balanced.length < maxArticles && otherArticles.length > 0) {
    for (const article of otherArticles) {
      balanced.push(article);
      if (balanced.length >= maxArticles) break;
    }
  }

  // Final count log
  const finalCounts = {};
  perspectives.forEach(p => finalCounts[p.id] = 0);

  balanced.forEach(a => {
    const pId = a.metadata?.perspective || a.metadata?.feedType;
    if (finalCounts[pId] !== undefined) finalCounts[pId]++;
  });

  const countStr = perspectives.map(p => `${finalCounts[p.id]} ${p.name}`).join(", ");
  console.log(`   ✅ Final balance: ${countStr} (total: ${balanced.length})`);

  return balanced;
}

// ============================================================================
// NEWS FETCHING (Google News RSS)
// ============================================================================

/**
 * Builds Google News RSS feed URL
 * @param {string} query - The search query (can include boolean operators)
 * @param {string} language - Language code (e.g., 'es', 'en')
 * @param {string} region - Region code (e.g., 'VE', 'US')
 */
function buildGoogleNewsUrl(query, language, region) {
  const encodedQuery = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${encodedQuery}&hl=${language}&gl=${region}&ceid=${region}:${language}`;
}

/**
 * Parses Google News RSS feed and returns articles with metadata
 */
async function parseRSSFeed(url, language, region, perspective) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  const response = await fetch(url, {
    headers: {
      "User-Agent": "News-Summarizer-Worker/1.0",
    },
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

  const derivedPerspective = perspective
    ? perspective.toLowerCase()
    : language === "es" && region === "VE"
      ? "venezuelan"
      : region === "US"
        ? "us"
        : "international";

  return items.map((item) => {
    // Extract source from title (Google News format: "Article Title - Source Name")
    const titleParts = item.title?.split(" - ") || [];
    const source =
      titleParts.length > 1 ? titleParts[titleParts.length - 1] : "Google News";
    const title =
      titleParts.length > 1 ? titleParts.slice(0, -1).join(" - ") : item.title;

    return {
      title: title || "Untitled",
      url: item.link || "",
      publishedAt: item.pubDate || new Date().toISOString(),
      description: item.description || "",
      source: {
        name: source,
      },
      metadata: {
        language: language,
        region: region,
        feedType: derivedPerspective,
        perspective: derivedPerspective,
      },
    };
  });
}

/**
 * Fetches news articles for a specific topic using Google News RSS feeds
 */
async function fetchNewsForTopic(topic, settings) {
  console.log(`\n📰 Fetching news for topic: ${topic.name}`);

  const feedArticles = {}; // Track articles per feed
  const maxArticles = settings.maxArticlesPerTopic || 10;
  const maxAgeDays = parseInt(settings.articleMaxAge || "7d");
  const minArticlesPerFeed = settings.minArticlesPerFeed;
  const deduplicationThreshold = settings.deduplicationSimilarityThreshold;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  try {
    // Fetch from each RSS feed configured for the topic
    for (const feed of topic.rssFeeds || []) {
      if (feed.type !== "google_news") continue;

      try {
        // Use per-feed query if available, otherwise fall back to topic query (backward compatibility)
        const query = feed.query || topic.query;

        if (!query) {
          console.log(
            `   ⚠️  No query specified for ${feed.language}-${feed.region} feed, skipping`,
          );
          continue;
        }

        const url = buildGoogleNewsUrl(query, feed.language, feed.region);

        console.log(`\n   📡 Fetching ${feed.language}-${feed.region} feed...`);
        console.log(
          `   Query: "${query.substring(0, 80)}${query.length > 80 ? "..." : ""}"`,
        );

        const articles = await retryWithBackoff(async () => {
          return await parseRSSFeed(
            url,
            feed.language,
            feed.region,
            feed.perspective,
          );
        });

        // Filter by date
        const recentArticles = articles.filter((article) => {
          const pubDate = new Date(article.publishedAt);
          return pubDate >= cutoffDate;
        });

        const feedKey = `${feed.language}-${feed.region}`;
        feedArticles[feedKey] = recentArticles;

        console.log(`   ✅ Found: ${recentArticles.length} articles`);
      } catch (error) {
        console.error(
          `   ❌ Failed to fetch ${feed.language}-${feed.region} feed: ${error.message}`,
        );
        // Continue with other feeds
      }
    }

    // Combine all articles
    const allArticles = Object.values(feedArticles).flat();

    if (allArticles.length === 0) {
      console.log(`\n   ⚠️  No articles found for ${topic.name}`);
      return [];
    }

    console.log(`\n   📊 Total articles collected: ${allArticles.length}`);

    // Remove duplicates by URL first
    const uniqueByUrl = Array.from(
      new Map(allArticles.map((a) => [a.url, a])).values(),
    );

    console.log(`   After URL deduplication: ${uniqueByUrl.length}`);

    // Apply similarity-based deduplication if threshold is set
    let deduplicated = uniqueByUrl;
    if (deduplicationThreshold && deduplicationThreshold > 0) {
      deduplicated = deduplicateArticles(uniqueByUrl, deduplicationThreshold);
    }

    // Sort by date (newest first)
    const sorted = deduplicated.sort(
      (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
    );

    // Balance articles if minArticlesPerFeed is set
    let finalArticles;
    if (minArticlesPerFeed && minArticlesPerFeed > 0) {
      finalArticles = balanceArticleSelection(
        sorted,
        maxArticles,
        minArticlesPerFeed,
        topic
      );
    } else {
      // Just take the top maxArticles
      finalArticles = sorted.slice(0, maxArticles);
      console.log(
        `\n   ✅ Selected top ${finalArticles.length} articles (no balancing)`,
      );
    }

    return finalArticles;
  } catch (error) {
    console.error(
      `\n   ❌ Error fetching news for ${topic.name}:`,
      error.message,
    );
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

  if (!topic.perspectives) {
    // Fallback for legacy topics (though we migrated them)
    console.warn(`Topic ${topic.name} has no perspectives defined!`);
    return null;
  }

  const perspectives = topic.perspectives;
  const buckets = {};
  perspectives.forEach(p => buckets[p.id] = []);
  const fallbackArticles = [];

  // Sort articles
  for (const article of articles) {
    const pId = article.metadata?.perspective || article.metadata?.feedType;
    const perspective = perspectives.find(p => p.id === pId);
    if (perspective) {
      buckets[perspective.id].push(article);
    } else {
      fallbackArticles.push(article);
    }
  }

  // Log counts
  perspectives.forEach(p => {
    console.log(`${p.name} sources: ${buckets[p.id].length}`);
  });
  if (fallbackArticles.length > 0) {
    console.log(`Other sources detected: ${fallbackArticles.length}`);
  }

  // Format text blocks
  const perspectiveTexts = perspectives.map(p => {
    const pArticles = buckets[p.id];
    const text = pArticles.length > 0
      ? pArticles.map((article, idx) => {
        return `Article ${idx + 1}:
Title: ${article.title}
Source: ${article.source.name}
Published: ${article.publishedAt}
Description: ${article.description || "N/A"}
---`;
      }).join("\n\n")
      : `No ${p.name} sources available`;

    return {
      id: p.id,
      name: p.name,
      text: text
    };
  });

  // Build Prompt
  let prompt = `You are a professional news analyst. Analyze and summarize news about ${topic.name} from different regional perspectives.\n\n`;

  perspectiveTexts.forEach(pt => {
    prompt += `${pt.name.toUpperCase()} SOURCES:\n${pt.text}\n\n`;
  });

  prompt += `Your response must be valid JSON matching the schema enforced by the system (arrays of bullet point strings for each field).

Requirements:
`;

  perspectiveTexts.forEach(pt => {
    prompt += `- ${pt.name} perspective: Pull core takeaways from ${pt.name} outlets\n`;
  });

  prompt += `- All responses must be provided ONLY as concise bullet points. Each bullet should capture a single idea.
- Overall highlights: Provide 3-5 bullet points that synthesize all perspectives into a single view
- Maintain neutrality - present all perspectives fairly
- If perspectives conflict, acknowledge this explicitly in the relevant bullet points
- If one perspective has no sources, note this and focus on available sources
- All output must be in English (translate foreign content as needed)
- DO NOT include any paragraph summaries or narrative text - only bullet points`;

  // Build Schema
  const properties = {
    overallHighlights: {
      type: "array",
      items: { type: "string" }
    }
  };

  const required = ["overallHighlights"];

  perspectives.forEach(p => {
    const key = `${p.id}Perspective`;
    properties[key] = {
      type: "array",
      items: { type: "string" }
    };
    required.push(key);
  });

  const summarySchema = {
    type: "object",
    additionalProperties: false,
    required: required,
    properties: properties
  };

  try {
    const response = await retryWithBackoff(async () => {
      return await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a professional news analyst who creates concise, accurate summaries comparing different regional perspectives on current events.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "news_summary",
            schema: summarySchema,
          },
        },
        temperature: 0.3,
        max_tokens: 3000,
      });
    });

    const summary = JSON.parse(response.choices[0].message.content);
    console.log(`Successfully summarized articles for ${topic.name}`);
    return summary;
  } catch (error) {
    console.error(
      `Error summarizing articles for ${topic.name}:`,
      error.message,
    );
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
  const sources = [...new Set(articles.map((a) => a.source.name))];
  const dateStr = formatDate(date);

  // Count articles by perspective
  const perspectives = topic.perspectives || [];
  const buckets = {};
  perspectives.forEach(p => buckets[p.id] = []);

  articles.forEach(a => {
    const pId = a.metadata?.perspective || a.metadata?.feedType;
    const p = perspectives.find(p => p.id === pId);
    if (p) buckets[p.id].push(a);
  });

  // Build perspectives metadata for frontmatter (YAML-safe format)
  const perspectivesYaml = perspectives.map(p => {
    // Escape quotes in names and icons
    const safeName = p.name.replace(/"/g, '\\"');
    const safeIcon = p.icon.replace(/"/g, '\\"');
    return `  - id: "${p.id}"\n    name: "${safeName}"\n    icon: "${safeIcon}"\n    count: ${buckets[p.id].length}`;
  }).join('\n');

  // Dynamic frontmatter fields for backward compatibility or convenience
  let dynamicFrontmatter = "";
  perspectives.forEach(p => {
    dynamicFrontmatter += `${p.id}Sources: ${buckets[p.id].length}\n`;
  });

  const frontMatter = `---
title: "${topic.name} News - ${dateStr}"
date: ${date.toISOString()}
topic: ${topic.id}
topicName: "${topic.name}"
sources: [${sources.map((s) => `"${s}"`).join(", ")}]
articleCount: ${articles.length}
perspectives:
${perspectivesYaml}
${dynamicFrontmatter}draft: false
---

`;

  const extractPoints = (value) => {
    if (!value) return [];
    if (Array.isArray(value))
      return value.filter((point) => !!point && point.toString().trim());
    if (Array.isArray(value.bulletPoints)) {
      return value.bulletPoints.filter(
        (point) => !!point && point.toString().trim(),
      );
    }
    if (
      value &&
      typeof value === "object" &&
      typeof value.summary === "string"
    ) {
      return value.summary
        .split(/\r?\n+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/\r?\n+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  };

  const formatBulletList = (points, fallback) => {
    if (!points || points.length === 0) {
      return fallback;
    }
    return points.map((point) => `- ${point}`).join("\n");
  };

  // Overall Highlights
  const overallHighlights = extractPoints(
    summary.overallHighlights || summary.overallSummary,
  );

  let markdown = frontMatter;

  markdown += `## Overall Highlights

${formatBulletList(overallHighlights, "- Unable to generate combined highlights.")}

`;

  // Perspective Sections
  perspectives.forEach(p => {
    const points = extractPoints(summary[`${p.id}Perspective`]);
    const count = buckets[p.id].length;

    markdown += `## ${p.name} Perspective (${p.name} Sources)

${count > 0 ? formatBulletList(points, `- No takeaways available for ${p.name} sources.`) : `- No ${p.name} sources available for this time period.`}

`;
  });

  // Sources Section
  markdown += `## Sources

This summary is based on ${articles.length} article${articles.length !== 1 ? "s" : ""} from the following sources:

${articles
      .map((article, idx) => {
        const lang = article.metadata?.language || "unknown";
        const region = article.metadata?.region || "unknown";
        const tag = `[${lang}-${region}]`;
        return `${idx + 1}. ${tag} [${article.title}](${article.url}) - ${article.source.name} (${new Date(article.publishedAt).toLocaleDateString()})`;
      })
      .join("\n")}
`;

  return markdown;
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
        Authorization: `token ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "News-Summarizer-Worker",
      },
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

  // Properly encode UTF-8 content to base64
  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(content);
  const base64Content = btoa(String.fromCharCode(...utf8Bytes));

  const body = {
    message: message,
    content: base64Content,
    branch: env.GITHUB_BRANCH || "main",
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "News-Summarizer-Worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to commit file: ${response.statusText} - ${errorText}`,
    );
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
  console.log("Purging Cloudflare cache for news.spagnuolo.biz...");

  // If CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are not set, skip cache purge
  if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
    console.log(
      "⚠️  Cache purge skipped - CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not configured",
    );
    return { success: false, skipped: true };
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefixes: ["news.spagnuolo.biz/"],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to purge cache: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    console.log(
      "✓ Successfully purged Cloudflare cache for news.spagnuolo.biz",
    );
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
    const articles = await fetchNewsForTopic(topic, env.topicsConfig.settings);

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
  console.log("========================================");
  console.log("News Summarizer Worker - Starting");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("========================================\n");

  const results = {
    timestamp: new Date().toISOString(),
    topics: [],
    success: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    // Initialize APIs
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    // Fetch topics configuration
    console.log("Fetching topics configuration...");
    const topicsConfig = await fetchTopicsConfig(env);
    env.topicsConfig = topicsConfig; // Store for later use

    const activeTopics = topicsConfig.topics.filter((t) => t.active);
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
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log("\n========================================");
    console.log("News Summarizer Worker - Complete");
    console.log(`Successful: ${results.success}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Failed: ${results.failed}`);
    console.log("========================================");

    // Purge Cloudflare cache if any summaries were successfully created
    if (results.success > 0) {
      console.log("\n");
      const cacheResult = await purgeCloudflareCache(env);
      results.cachePurge = cacheResult;
    }

    return results;
  } catch (error) {
    console.error("Critical error in scheduled handler:", error);
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
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/trigger"
    ) {
      // Allow manual triggering via POST request for testing
      const results = await handleScheduled({}, env);
      return new Response(JSON.stringify(results, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      "News Summarizer Worker is running. Use cron trigger or POST to /trigger for manual execution.",
      {
        status: 200,
      },
    );
  },
};

// Export functions for testing
export {
  deduplicateArticles,
  balanceArticleSelection,
  buildGoogleNewsUrl,
  jaccardSimilarity,
  generateHugoMarkdown,
  formatDate
};
