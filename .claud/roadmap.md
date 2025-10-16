# Development Roadmap

## Phase 1: Foundation (Current - Week 1)
- [x] Per-feed query support
- [x] Article balancing (min articles per perspective)
- [x] Deduplication of similar articles
- [ ] Code restructuring into modules
- [ ] Basic test infrastructure
- [ ] Comprehensive documentation
- [ ] Local development workflow

## Phase 2: Expansion (Weeks 2-3)
- [ ] Add Argentina topic (Milei, economy, protests)
- [ ] Add Cuba topic (government, US relations, emigration)
- [ ] Styling improvements for Hugo site
  - [ ] Better mobile layout
  - [ ] Dark mode
  - [ ] Improved typography
- [ ] Cost monitoring dashboard
- [ ] Automated testing in CI/CD

## Phase 3: Enhancement (Weeks 3-4)
- [ ] Summary format variations (brief/detailed/academic)
- [ ] Historical context from YouTube videos
  - [ ] Transcript fetching
  - [ ] Context injection into prompts
- [ ] RSS feed for subscribers
- [ ] Email notifications (optional)
- [ ] Search functionality

## Phase 4: Advanced Features (Month 2+)
- [ ] Multiple summary styles
  - [ ] Brief (2-3 paragraphs)
  - [ ] Detailed (current format)
  - [ ] Academic (with citations)
- [ ] Sentiment analysis comparison
- [ ] Timeline view of events
- [ ] API endpoint for programmatic access
- [ ] Mobile app (React Native or PWA)

## Backlog / Ideas
- [ ] Blockchain archiving for immutability
- [ ] Multi-language site (Spanish, Portuguese)
- [ ] User comments/discussion
- [ ] Fact-checking integration
- [ ] Related articles suggestions
- [ ] Weekly/monthly digest emails
- [ ] Social media integration
- [ ] Analytics dashboard

## Questions to Resolve
- Best way to handle seasonal/slow news days?
  - Maybe fetch from longer time period?
  - Or skip day if too few articles?
- How to present conflicting narratives?
  - Current format seems good, but could add controversy indicators
- Optimal article count per perspective?
  - Current: 10 per side seems balanced
  - Could make configurable per topic
- Should we archive old summaries?
  - Yes, but need compression strategy
- How to validate summary quality?
  - Manual review for now
  - Could add automated checks (length, balance, etc.)

## Performance Goals
- Worker execution: <15 seconds
- Memory usage: <100MB
- OpenAI cost: <$0.10 per summary
- Site load time: <2 seconds
- Mobile responsive: 100% pages

## Technical Debt
- Refactor worker into modules (Phase 1)
- Add comprehensive error handling
- Implement retry logic for all APIs
- Add input validation
- Create fixtures for testing
- Document all functions
