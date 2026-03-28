# Module: SEO Audit

## Purpose

SEO analysis of single or multiple URLs. Checks meta tags, heading structure, technical SEO factors, and calculates a score (0-100). Optional: broken link check.

## Features

- **SEO Score** — 0-100 points, color-coded (green/yellow/orange/red)
- **Meta Tag Analysis** — Title, description, canonical, robots
- **Heading Structure** — H1-H6 count with validation
- **Technical Checks** — Viewport, charset, favicon, JSON-LD, OpenGraph, Twitter Cards
- **Broken Link Check** — Optional, checks up to 20 links per page
- **Bulk Analysis** — Audit multiple URLs simultaneously
- **History** — Last 20 audits stored in localStorage
- **Auto-Export** — JSON and CSV in `output/seo-audit/`

## Data Model

- **Endpoint:** `POST /api/seo-audit`
- **Output:** `output/seo-audit/{timestamp}_seo-audit.{json,csv}`
- Details: see [data-model.md](../data-model.md#post-apiseo-audit)

## Data Flow

1. User enters URLs (single or bulk)
2. Optional: enable broken link check
3. Server fetches each URL and analyzes the HTML content
4. Score calculation: starts at 100, deductions for issues
5. Results are displayed as cards with details
6. Auto-save as JSON/CSV when `saveResults` is enabled

## Score Calculation

Starting value: **100 points**

| Check | Deduction | Good when |
|-------|-----------|-----------|
| No title | -15 | Title present |
| Title too short (<30) or long (>60) | -5 | 30-60 characters |
| No meta description | -10 | Description present |
| Description too short (<120) or long (>160) | -3 | 120-160 characters |
| No canonical | -5 | Canonical URL set |
| No H1 | -10 | Exactly one H1 |
| Multiple H1 | -5 | — |
| Images without alt text | -2 per image (max -10) | All images with alt |
| No viewport meta | -5 | Viewport set |
| No JSON-LD | -3 | Structured data present |
| No Open Graph | -3 | OG tags present |
| Broken links | -3 per link (max -15) | No broken links |

## Color Coding

| Score | Color | Rating |
|-------|-------|--------|
| 80-100 | Green | Good |
| 60-79 | Yellow | Needs improvement |
| 40-59 | Orange | Problematic |
| 0-39 | Red | Critical |
