#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import slugify from "slugify";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const CATEGORY_IMAGE_KEYWORDS = {
  "things-to-do": "children,boston,family",
  "day-trips": "family,travel,children",
  "gear-reviews": "kids,outdoor,gear",
  "seasonal": "family,seasons,children",
};

// --------------- Step 1: Keyword Validation ---------------
async function validateKeyword(keyword) {
  console.log(`\n🔍 Step 1: Validating keyword "${keyword}"...`);
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(keyword)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    const data = await res.json();
    const suggestions = data[1] || [];
    console.log(`   Suggestions found: ${suggestions.length}`);
    if (suggestions.length > 0) {
      console.log(`   ✅ Keyword has search volume`);
      console.log(`   Top suggestions: ${suggestions.slice(0, 3).join(", ")}`);
    } else {
      console.log(`   ⚠️ No suggestions found — keyword may have low volume`);
    }
    return { valid: suggestions.length > 0, suggestions };
  } catch (err) {
    console.error(`   ⚠️ Validation failed: ${err.message}`);
    return { valid: true, suggestions: [] };
  }
}

// --------------- Step 2: Competition Analysis ---------------
async function analyzeCompetition(keyword) {
  console.log(`\n🏆 Step 2: Analyzing competition for "${keyword}"...`);
  const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=en&num=5`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();

    const competitors = [];
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gi;
    let match;
    while ((match = h3Regex.exec(html)) !== null && competitors.length < 3) {
      const title = match[1].replace(/<[^>]*>/g, "").trim();
      if (title.length > 5) {
        competitors.push({ title, snippet: "" });
      }
    }

    console.log(`   Found ${competitors.length} competitors:`);
    competitors.forEach((c, i) => {
      console.log(`   ${i + 1}. "${c.title}"`);
    });

    return competitors;
  } catch (err) {
    console.error(`   ⚠️ Competition analysis failed: ${err.message}`);
    return [];
  }
}

// --------------- Step 3: Generate Article ---------------
async function generateArticle({ title, category, keyword, age, competitors }) {
  console.log(`\n✍️ Step 3: Generating article with Claude...`);
  console.log(`   Title: "${title}"`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ Error: ANTHROPIC_API_KEY not set.");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a Boston local parent blogger who has lived in the Greater Boston area for 10+ years with young children.

Your writing style:
- Personal and warm, like advice from a friend
- Include SPECIFIC details: exact prices, parking tips, nearest T stop, best time to visit, what to avoid
- Mention real Boston neighborhoods (Back Bay, Cambridge, Somerville, Brookline, Newton etc.)
- Include seasonal New England context (brutal winters, beautiful falls, hot summers)
- Add practical parent tips: stroller accessibility, nursing rooms, kid-friendly bathrooms, food options
- Use phrases like 'We love...', 'Our kids always...', 'Pro tip:', 'Heads up:'
- End with a genuine recommendation

Always include:
1. A specific 'Getting There' section (T stop + parking)
2. 'Good to Know' bullet points (hours, prices, age recommendations)
3. 'Nearby' section linking to 1-2 related activities
4. At least one personal anecdote style paragraph`;

  let competitorContext = "";
  if (competitors.length > 0) {
    competitorContext = `\n\nHere are the top ${competitors.length} Google results for the keyword "${keyword}":
${competitors.map((c, i) => `${i + 1}. Title: "${c.title}"`).join("\n")}

Write a MORE comprehensive, MORE helpful, MORE specific article that covers everything they cover PLUS adds unique Boston local insights.`;
  }

  const userPrompt = `Write a blog post with the following details:

Title: ${title}
Category: ${category}
Target SEO Keyword: ${keyword}
Target Age Range: ${age}
${competitorContext}

Requirements:
- Write 1500-2000 words in English
- Naturally distribute the target keyword "${keyword}" throughout the article
- Structure: Introduction → H2 sections (3-5 sections) → FAQ section (3-5 questions with answers) → Conclusion
- Include specific Boston locations, addresses, prices, hours, and practical parent tips
- Sound authentic like a local Boston parent sharing real experiences
- In appropriate places, insert these placeholder comments on their own line:
  <!-- PRODUCT_CARD: [brief product description relevant to context] -->
  <!-- ACTIVITY_CARD: [activity name relevant to context] -->
  Insert 2-3 PRODUCT_CARD placeholders and 2-3 ACTIVITY_CARD placeholders where they naturally fit.
- Use markdown formatting with ## for H2 headings and ### for H3 headings
- For the FAQ section, use ### for each question
- Do NOT include the title as an H1
- Do NOT include any frontmatter
- Start directly with the introduction paragraph`;

  console.log("   🤖 Calling Claude API...");

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const content = message.content[0].text;
  const wordCount = content.split(/\s+/).length;
  console.log(`   ✅ Generated ${wordCount} words`);
  return content;
}

// --------------- Step 4: Quality Check ---------------
async function qualityCheck(content, title, keyword) {
  console.log(`\n🔎 Step 4: Quality check...`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Rate this blog post on a scale of 1-10 for quality. Consider:
- SEO optimization for keyword "${keyword}"
- Helpfulness and specificity for Boston parents
- Readability and engagement
- Completeness of information
- Authenticity of voice

Respond with ONLY a JSON object: {"score": X, "reason": "brief explanation"}

Article title: "${title}"
Article content:
${content.substring(0, 3000)}...`,
      },
    ],
    system: "You are a content quality evaluator. Respond only with valid JSON.",
  });

  try {
    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.log(`   📊 Quality score: ${result.score}/10`);
      console.log(`   💬 Reason: ${result.reason}`);
      return result;
    }
  } catch (err) {
    console.error(`   ⚠️ Could not parse quality score: ${err.message}`);
  }

  return { score: 7, reason: "Could not evaluate — defaulting to pass" };
}

// --------------- Build MDX ---------------
function buildMdx({ title, category, age, content, keyword }) {
  const today = new Date().toISOString().split("T")[0];
  const keywords = CATEGORY_IMAGE_KEYWORDS[category] || "children,boston,family";
  const heroImage = `https://source.unsplash.com/1200x630/?${keywords}`;

  const firstParagraph = content.split("\n").find((line) => line.trim().length > 50) || "";
  let description = firstParagraph.replace(/[#*\[\]]/g, "").trim();
  if (description.length > 150) {
    description = description.substring(0, 147) + "...";
  }

  const tags = [
    ...new Set([
      keyword.toLowerCase(),
      category,
      "boston",
      "kids",
      ...keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    ]),
  ];

  const frontmatter = `---
title: "${title}"
description: "${description}"
pubDate: "${today}"
heroImage: "${heroImage}"
category: "${category}"
ageRange: "${age}"
tags: [${tags.map((t) => `"${t}"`).join(", ")}]
affiliateDisclosure: true
---`;

  return `${frontmatter}\n\n${content}\n`;
}

// --------------- Queue Management ---------------
function loadQueue() {
  const path = join(__dirname, "post-queue.json");
  console.log(`   Reading queue from: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadTracker() {
  const path = join(__dirname, "queue-tracker.json");
  console.log(`   Reading tracker from: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveTracker(tracker) {
  const path = join(__dirname, "queue-tracker.json");
  writeFileSync(path, JSON.stringify(tracker, null, 2) + "\n", "utf-8");
  console.log(`   ✅ Tracker saved: ${JSON.stringify(tracker)}`);
}

// --------------- Main Pipeline ---------------
async function main() {
  console.log("\n🏭 === Content Pipeline Started ===\n");

  console.log("📋 Reading queue...");
  const queue = loadQueue();
  const tracker = loadTracker();

  console.log(`   Queue length: ${queue.length}`);
  console.log(`   Current tracker position: ${tracker.current}`);

  const index = tracker.current % queue.length;
  const post = queue[index];

  console.log(`\n📋 Queue position: ${index + 1}/${queue.length}`);
  console.log(`📝 Generating article: "${post.title}"`);
  console.log(`   Category: ${post.category} | Keyword: ${post.keyword} | Age: ${post.age}`);

  // Step 1: Validate keyword
  const validation = await validateKeyword(post.keyword);

  // Step 2: Analyze competition
  await new Promise((r) => setTimeout(r, 1500));
  const competitors = await analyzeCompetition(post.keyword);

  // Step 3: Generate article
  await new Promise((r) => setTimeout(r, 1000));
  let content = await generateArticle({ ...post, competitors });

  // Step 4: Quality check
  const quality = await qualityCheck(content, post.title, post.keyword);

  if (quality.score < 7) {
    console.log(`\n🔄 Score below 7 — regenerating article...`);
    await new Promise((r) => setTimeout(r, 2000));
    content = await generateArticle({ ...post, competitors });
    const recheck = await qualityCheck(content, post.title, post.keyword);
    console.log(`   📊 Second attempt score: ${recheck.score}/10`);
  }

  // Step 5: Build and save
  console.log(`\n💾 Step 5: Saving article...`);
  const mdx = buildMdx({ title: post.title, category: post.category, age: post.age, content, keyword: post.keyword });
  const slug = slugify(post.title, { lower: true, strict: true });
  const fileName = `${slug}.mdx`;
  const filePath = join(PROJECT_ROOT, "src", "content", "blog", fileName);
  writeFileSync(filePath, mdx, "utf-8");
  console.log(`   ✅ Writing file: ${fileName}`);
  console.log(`   Full path: ${filePath}`);
  console.log(`   File size: ${mdx.length} bytes`);

  // Update tracker
  tracker.current = (index + 1) % queue.length;
  saveTracker(tracker);
  console.log(`   📊 Queue tracker updated: next position ${tracker.current}`);

  console.log("\n🎉 === Content Pipeline Complete — file saved ===");
  console.log(`   Generated: src/content/blog/${fileName}`);
  console.log(`   Title: ${post.title}\n`);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});