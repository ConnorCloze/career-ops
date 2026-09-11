#!/usr/bin/env node
// Generalist World (generalist.world/jobs) local parser -- career-ops scan.mjs, jobs-json-v1.
//
// Unlike every other portals.yml entry, this is a BOARD, not one company: a
// curated list of "roles that value breadth" run by Generalist World, with a
// different employer on every card. So each emitted job carries its OWN
// `company` (from .gw-job-company) rather than inheriting the portals.yml
// entry name -- providers/local-parser.mjs prefers job.company over entry.name,
// which is what makes a multi-employer source work at all here.
//
// Server-rendered WordPress: the full board is in the raw HTML on one page,
// no pagination and no client-side fetch (confirmed 2026-09-11 via plain curl
// -- 138 cards, no load-more/paged= markers). Fetch + regex is enough, no
// Playwright.
//
// HTML shape being matched (as of 2026-09-11):
//   <a class="gw-job-card" data-type="..." data-region="..." href="/jobs/{slug}/">
//     <div class="gw-job-card-top"><div>
//       <span class="gw-job-new-badge">New</span>
//       <div class="gw-job-company">{Company}</div>
//       <div class="gw-job-title">{Title}</div>
//     ...
//     <span class="gw-job-meta-tag gw-location">{Location}</span>

const BASE_URL = 'https://generalist.world';
const JOBS_PATH = '/jobs/';

// The board is one static page, but it is ~300KB of HTML -- guard against a
// redirect to something unbounded rather than streaming it all into memory.
const MAX_BYTES = 5_000_000;

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const res = await fetch(`${BASE_URL}${JOBS_PATH}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; career-ops-local-parser/1.0)' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Generalist World jobs page fetch failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  if (html.length > MAX_BYTES) {
    throw new Error(`Generalist World jobs page unexpectedly large (${html.length} bytes) -- refusing to parse`);
  }

  const jobs = [];
  const seen = new Set();
  // Non-greedy up to the next card anchor (or end) so one malformed card can't
  // swallow the rest of the board.
  const cardRe = /<a class="gw-job-card"([^>]*)href="(\/jobs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = cardRe.exec(html))) {
    const [, attrs, href, block] = match;
    const company = decodeEntities((block.match(/class="gw-job-company"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
    const title = decodeEntities((block.match(/class="gw-job-title"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
    let location = decodeEntities((block.match(/class="[^"]*gw-location"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
    if (!location) {
      // Cards with no explicit location tag still carry data-region on the
      // anchor; a bare "remote" beats an empty location downstream, where
      // triage judges location as one of only two signals it has.
      const region = (attrs.match(/data-region="([^"]*)"/) || [])[1] || '';
      location = region ? region.replace(/[-_]/g, ' ').trim() : '';
    }
    if (!title) continue;

    const url = `${BASE_URL}${href}`;
    if (seen.has(url)) continue;
    seen.add(url);

    jobs.push({ title, url, location, company: company || 'Generalist World (board)' });
  }

  if (jobs.length === 0) {
    // Zero listings on a curated board with a 61k-subscriber newsletter behind
    // it almost always means the card markup moved, not that the board emptied
    // -- fail loud rather than silently reporting an empty scan.
    throw new Error('Generalist World parser matched 0 jobs -- page structure likely changed, needs re-checking');
  }

  process.stdout.write(JSON.stringify(jobs));
}

main().catch(err => {
  console.error(String((err && err.stack) || err));
  process.exit(1);
});
