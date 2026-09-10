#!/usr/bin/env node
// Qualia (qualia.com/jobs) local parser -- career-ops scan.mjs, jobs-json-v1.
//
// Qualia self-hosts its own job listing page with no third-party ATS behind
// it (confirmed 2026-08-22 via a live network-request trace -- no calls to
// any recognized ATS host at all). The listings ARE present in the raw
// server-rendered HTML though (confirmed via plain curl, no JS needed), so a
// fetch + regex parser is enough -- no Playwright required for this one.
//
// HTML shape being matched (stable as of 2026-08-22):
//   <a href="/jobs/{slug}" class="row">
//     <div class="column">{Title}</div>
//     <centerText class="column" data-label="Type">{Type}</centerText>
//     <centerText class="column" data-label="Location">{Location}</centerText>
//   </a>

const BASE_URL = 'https://www.qualia.com';
const JOBS_PATH = '/jobs/';

async function main() {
  const res = await fetch(`${BASE_URL}${JOBS_PATH}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; career-ops-local-parser/1.0)' },
  });
  if (!res.ok) {
    throw new Error(`Qualia jobs page fetch failed: HTTP ${res.status}`);
  }
  const html = await res.text();

  const jobs = [];
  const rowRe = /<a href="(\/jobs\/[^"]+)" class="row">([\s\S]*?)<\/a>/g;
  let match;
  while ((match = rowRe.exec(html))) {
    const [, href, block] = match;
    const titleMatch = block.match(/<div class="column">\s*([\s\S]*?)\s*<\/div>/);
    const locationMatch = block.match(/data-label="Location"\s*>\s*([\s\S]*?)\s*<\/centerText>/);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const location = locationMatch ? locationMatch[1].trim() : '';
    if (!title) continue;
    jobs.push({
      title,
      url: `${BASE_URL}${href}`,
      location,
      company: 'Qualia',
    });
  }

  if (jobs.length === 0) {
    // Zero listings almost always means the page structure changed under us,
    // not that Qualia genuinely has no openings -- fail loud rather than
    // silently reporting an empty (and misleading) scan result.
    throw new Error('Qualia parser matched 0 jobs -- page structure likely changed, needs re-checking');
  }

  process.stdout.write(JSON.stringify(jobs));
}

main().catch(err => {
  console.error(String((err && err.stack) || err));
  process.exit(1);
});
