#!/usr/bin/env node

import * as cheerio from "cheerio";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const SEED_KEYWORDS = [
  "kids boston",
  "children boston",
  "family boston",
  "toddler boston",
  "things to do boston kids",
];

const CATEGORY_MATCHERS = [
  { pattern: /day trip|trip from|road trip|drive to|weekend getaway/i, category: "day-trips" },
  { pattern: /gear|boot|stroller|jacket|coat|rain|snow|car seat|backpack/i, category: "gear-reviews" },
  { pattern: /fall|spring|summer|winter|halloween|christmas|pumpkin|seasonal|holiday/i, category: "seasonal" },
];

function guessCategory(keyword) {
  for (const matcher of CATEGORY_MATCHERS) {
    if (matcher.pattern.test(keyword)) return matcher.category;
  }
  return "things-to-do";
}

function guessAge(keyword) {
  if (/toddler|baby|infant/i.test(keyword)) return "0-4 years";
  if (/teen/i.test(keyword)) return "10-17 years";
  return "2-12 years";
}

function titleCase(str) {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// --------------- Google Suggest API ---------------
async function getGoogleSuggestions(keyword) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(keyword)}`;
  console.log(`  📡 Fetching suggestions for: "${keyword}"`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    const data = await res.json();
    const suggestions = data[1] || [];
    console.log(`     Found ${suggestions.length} suggestions`);
    return suggestions;
  } catch (err) {
    console.error(`     ⚠️ Failed to fetch suggestions: ${err.message}`);
    return [];
  }
}

// --------------- Google Search Scraping ---------------
async function getRelatedSearches(keyword) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=en`;
  console.log(`  🔍 Scraping related searches for: "${keyword}"`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Related searches at bottom
    const relatedSearches = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("/search?q=") && !href.includes("&tbm=")) {
        const text = $(el).text().trim();
        if (text.length > 5 && text.length < 80 && /kid|child|famil|toddler|baby|boston/i.test(text)) {
          relatedSearches.push(text);
        }
      }
    });

    // People Also Ask
    const paaQuestions = [];
    $("[data-q]").each((_, el) => {
      const question = $(el).attr("data-q");
      if (question && /kid|child|famil|toddler|baby|boston/i.test(question)) {
        paaQuestions.push(question);
      }
    });

    // Also try jscontroller-based PAA
    $("span").each((_, el) => {
      const text = $(el).text().trim();
      if (
        text.endsWith("?") &&
        text.length > 15 &&
        text.length < 100 &&
        /kid|child|famil|toddler|baby|boston/i.test(text)
      ) {
        if (!paaQuestions.includes(text)) {
          paaQuestions.push(text);
        }
      }
    });

    console.log(`     Found ${relatedSearches.length} related searches, ${paaQuestions.length} PAA questions`);
    return { relatedSearches, paaQuestions };
  } catch (err) {
    console.error(`     ⚠️ Failed to scrape Google: ${err.message}`);
    return { relatedSearches: [], paaQuestions: [] };
  }
}

// --------------- Main ---------------
async function main() {
  console.log("\n🔬 Starting keyword research...\n");

  // Load existing queue
  const queuePath = join(__dirname, "post-queue.json");
  const existingQueue = JSON.parse(readFileSync(queuePath, "utf-8"));
  const existingTitles = new Set(existingQueue.map((p) => p.title.toLowerCase()));
  const existingKeywords = new Set(existingQueue.map((p) => p.keyword.toLowerCase()));

  console.log(`📋 Existing queue has ${existingQueue.length} posts\n`);

  const discoveredKeywords = new Map(); // keyword -> source info

  // Step 1: Google Suggest for each seed
  console.log("=== Step 1: Google Suggestions ===\n");
  for (const seed of SEED_KEYWORDS) {
    const suggestions = await getGoogleSuggestions(seed);
    for (const suggestion of suggestions) {
      const lower = suggestion.toLowerCase();
      if (!existingKeywords.has(lower) && !discoveredKeywords.has(lower)) {
        discoveredKeywords.set(lower, { source: "suggest", original: suggestion });
      }
    }
    // Rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Step 2: Related searches & PAA for each seed
  console.log("\n=== Step 2: Related Searches & People Also Ask ===\n");
  for (const seed of SEED_KEYWORDS) {
    const { relatedSearches, paaQuestions } = await getRelatedSearches(seed);

    for (const rs of relatedSearches) {
      const lower = rs.toLowerCase();
      if (!existingKeywords.has(lower) && !discoveredKeywords.has(lower)) {
        discoveredKeywords.set(lower, { source: "related", original: rs });
      }
    }

    for (const paa of paaQuestions) {
      const lower = paa.toLowerCase();
      if (!existingKeywords.has(lower) && !discoveredKeywords.has(lower)) {
        discoveredKeywords.set(lower, { source: "paa", original: paa });
      }
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Step 3: Format as post configs
  console.log(`\n=== Step 3: Processing ${discoveredKeywords.size} new keywords ===\n`);

  const newPosts = [];
  for (const [keyword, info] of discoveredKeywords) {
    // Skip very short or very long keywords
    if (keyword.length < 10 || keyword.length > 80) continue;

    const category = guessCategory(keyword);
    const age = guessAge(keyword);
    const title = titleCase(info.original);

    // Skip if title is too similar to existing
    const isDuplicate = [...existingTitles].some((existing) => {
      const overlap = existing.split(" ").filter((w) => title.toLowerCase().includes(w));
      return overlap.length > 4;
    });

    if (isDuplicate) {
      console.log(`  ⏭️  Skipping (too similar): "${title}"`);
      continue;
    }

    newPosts.push({
      title,
      category,
      keyword,
      age,
    });
    console.log(`  ✅ Added: "${title}" [${category}] (from ${info.source})`);
  }

  if (newPosts.length === 0) {
    console.log("\n📭 No new keywords found. Queue is already comprehensive.");
    return;
  }

  // Step 4: Append to queue
  const updatedQueue = [...existingQueue, ...newPosts];
  writeFileSync(queuePath, JSON.stringify(updatedQueue, null, 2) + "\n", "utf-8");

  console.log(`\n📝 Added ${newPosts.length} new posts to queue`);
  console.log(`📋 Total queue size: ${updatedQueue.length} posts`);

  // Step 5: Git commit
  try {
    console.log("\n🔄 Committing updated queue...");
    execSync("git add scripts/post-queue.json", { cwd: PROJECT_ROOT, stdio: "inherit" });
    execSync(`git commit -m "research: add ${newPosts.length} new keyword-based articles to queue"`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    execSync("git push origin main", { cwd: PROJECT_ROOT, stdio: "inherit" });
    console.log("✅ Pushed to origin/main");
  } catch (err) {
    console.error("⚠️  Git push failed:", err.message);
  }

  console.log("\n🎉 Keyword research complete!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});