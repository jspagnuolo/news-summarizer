# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Claude Code context files (.claud/) for project documentation
- Per-feed query support (different search terms per RSS feed)
- Article balancing (ensures minimum articles per perspective)
- Deduplication of similar articles using Jaccard similarity
- Structured logging with emoji indicators
- Comprehensive .gitignore for all environments
- .env.example for environment variable documentation
- ARCHITECTURE.md with system diagrams
- CHANGELOG.md (this file)

### Changed
- Increased maxArticlesPerTopic from 10 to 20
- Reduced articleMaxAge from 7d to 5d for fresher content
- Enhanced error handling with graceful degradation
- Improved logging output with context and structure

### Fixed
- Typo in .gitignore (worker/.enf → worker/.env)

## [1.0.0] - 2025-10-11

### Added
- Initial release of News Summarizer
- Venezuela topic tracking
- Dual-perspective summaries (Venezuelan vs International)
- Daily automated news gathering via Cloudflare Workers cron
- AI-powered summarization using OpenAI GPT-4o-mini
- Hugo static site generation
- Automated Git commits to GitHub
- Source attribution for all articles
- Key differences highlighting between perspectives
- Cloudflare cache purging after updates

### Features
- Google News RSS feed integration
- Multi-language support (Spanish and English)
- Regional perspective comparison
- Automated deployment pipeline
- Cost-conscious design (~$1-2/month)

## [0.1.0] - 2025-10-01

### Added
- Initial project setup
- Basic worker structure
- Hugo site scaffolding
- Development environment configuration
