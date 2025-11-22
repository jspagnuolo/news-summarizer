// Test script to debug Japan feed
import { XMLParser } from "fast-xml-parser";

async function parseRSSFeed(url, language, region, perspective) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
    });

    console.log(`\nFetching: ${url}`);
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

    return items.map((item) => {
        const titleParts = item.title?.split(" - ") || [];
        const source =
            titleParts.length > 1 ? titleParts[titleParts.length - 1] : "Google News";
        const title =
            titleParts.length > 1 ? titleParts.slice(0, -1).join(" - ") : item.title;

        return {
            title: title || "Untitled",
            url: item.link || "",
            publishedAt: item.pubDate || new Date().toISOString(),
            source: source,
            perspective: perspective,
        };
    });
}

// Test Japan feed
const query = encodeURIComponent("中国 site:.jp");
const url = `https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`;

const articles = await parseRSSFeed(url, "ja", "JP", "japan");

console.log(`\nFound ${articles.length} articles from Japan feed`);
console.log("\nFirst 5 articles:");
articles.slice(0, 5).forEach((a, i) => {
    console.log(`${i + 1}. [${a.perspective}] ${a.title} - ${a.source}`);
    console.log(`   Published: ${a.publishedAt}`);
});
