import { describe, it, expect } from 'vitest';
import {
    deduplicateArticles,
    balanceArticleSelection,
    buildGoogleNewsUrl,
    jaccardSimilarity,
    formatDate
} from './index.js';

describe('News Summarizer Worker', () => {

    describe('jaccardSimilarity', () => {
        it('should return 1 for identical strings', () => {
            expect(jaccardSimilarity('hello world', 'hello world')).toBe(1);
        });

        it('should return 0 for completely different strings', () => {
            expect(jaccardSimilarity('hello world', 'foo bar')).toBe(0);
        });

        it('should return a value between 0 and 1 for similar strings', () => {
            const sim = jaccardSimilarity('hello world', 'hello there');
            expect(sim).toBeGreaterThan(0);
            expect(sim).toBeLessThan(1);
        });

        it('should be case insensitive', () => {
            expect(jaccardSimilarity('Hello World', 'hello world')).toBe(1);
        });
    });

    describe('deduplicateArticles', () => {
        it('should remove exact duplicates', () => {
            const articles = [
                { title: 'Article 1', url: 'http://example.com/1' },
                { title: 'Article 1', url: 'http://example.com/1' }
            ];
            const result = deduplicateArticles(articles);
            expect(result).toHaveLength(1);
        });

        it('should remove similar articles based on threshold', () => {
            const articles = [
                { title: 'The quick brown fox jumps over the dog', url: 'http://example.com/1' },
                { title: 'The quick brown fox jumped over the dog', url: 'http://example.com/2' } // Very similar
            ];
            const result = deduplicateArticles(articles, 0.5);
            expect(result).toHaveLength(1);
        });

        it('should keep dissimilar articles', () => {
            const articles = [
                { title: 'The quick brown fox', url: 'http://example.com/1' },
                { title: 'Lorem ipsum dolor sit amet', url: 'http://example.com/2' }
            ];
            const result = deduplicateArticles(articles, 0.5);
            expect(result).toHaveLength(2);
        });
    });

    describe('balanceArticleSelection', () => {
        it('should balance articles between perspectives', () => {
            const articles = [
                { title: 'US 1', metadata: { perspective: 'us' } },
                { title: 'US 2', metadata: { perspective: 'us' } },
                { title: 'US 3', metadata: { perspective: 'us' } },
                { title: 'VE 1', metadata: { perspective: 'venezuelan' } },
                { title: 'VE 2', metadata: { perspective: 'venezuelan' } },
            ];

            // Max 4 articles, should take 2 from each if possible
            const result = balanceArticleSelection(articles, 4, 1);

            const usCount = result.filter(a => a.metadata.perspective === 'us').length;
            const veCount = result.filter(a => a.metadata.perspective === 'venezuelan').length;

            expect(result).toHaveLength(4);
            expect(usCount).toBe(2);
            expect(veCount).toBe(2);
        });

        it('should fill with available articles if one side is short', () => {
            const articles = [
                { title: 'US 1', metadata: { perspective: 'us' } },
                { title: 'US 2', metadata: { perspective: 'us' } },
                { title: 'US 3', metadata: { perspective: 'us' } },
                { title: 'VE 1', metadata: { perspective: 'venezuelan' } }, // Only 1 VE
            ];

            const result = balanceArticleSelection(articles, 4, 0);

            expect(result).toHaveLength(4);
            expect(result.filter(a => a.metadata.perspective === 'venezuelan')).toHaveLength(1);
            expect(result.filter(a => a.metadata.perspective === 'us')).toHaveLength(3);
        });
    });

    describe('buildGoogleNewsUrl', () => {
        it('should construct a valid Google News RSS URL', () => {
            const url = buildGoogleNewsUrl('test query', 'en', 'US');
            expect(url).toContain('https://news.google.com/rss/search');
            expect(url).toContain('q=test%20query');
            expect(url).toContain('hl=en');
            expect(url).toContain('gl=US');
            expect(url).toContain('ceid=US:en');
        });
    });

    describe('formatDate', () => {
        it('should format date as YYYY-MM-DD', () => {
            const date = new Date('2023-01-01T12:00:00Z');
            expect(formatDate(date)).toBe('2023-01-01');
        });
    });
});
