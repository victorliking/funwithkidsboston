#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import slugify from "slugify";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const VALID_CATEGORIES = ["things-to-do", "day-trips", "gear-reviews", "seasonal"];

const CATEGORY_IMAGE_KEYWORDS = {
  "things-to-do": "children,boston,family",
  "day-trips": "family,travel,children",
  "gear-reviews": "kids,outdoor,gear",
  "seasonal": "family,seasons,children",
};

// --------------- Generate content via Claude ---------------
async function generatePost({ title, category, keyword, age }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
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

  const userPrompt = `Write a blog post with the following details:

Title: ${title}
Category: ${category}
Target SEO Keyword: ${keyword}
Target Age Range: ${age}

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
- Do NOT include the title as an H1 — it will be added automatically from frontmatter
- Do NOT include any frontmatter — it will be added separately
- Start directly with the introduction paragraph`;

  console.log("🤖 Calling Claude API to generate content...");

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
    system: systemPrompt,
  });

  const content = message.content[0].text;
  console.log(`✅ Generated ${content.split(/\s+/).length} words`);
  return content;
}

// --------------- Build MDX file ---------------
function getHeroImageUrl(category) {
  const keywords = CATEGORY_IMAGE_KEYWORDS[category] || "children,boston,family";
  return `https://source.unsplash.com/1200x630/?${keywords}`;
}

function buildMdx({ title, category, age, content, keyword }) {
  const today = new Date().toISOString().split("T")[0];
  const heroImage = getHeroImageUrl(category);

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

// --------------- Queue management ---------------
function loadQueue() {
  const queuePath = join(__dirname, "post-queue.json");
  return JSON.parse(readFileSync(queuePath, "utf-8"));
}

function loadTracker() {
  const trackerPath = join(__dirname, "queue-tracker.json");
  return JSON.parse(readFileSync(trackerPath, "utf-8"));
}

function saveTracker(tracker) {
  const trackerPath = join(__dirname, "queue-tracker.json");
  writeFileSync(trackerPath, JSON.stringify(tracker, null, 2) + "\n", "utf-8");
}

// --------------- Main ---------------
async function main() {
  const queue = loadQueue();
  const tracker = loadTracker();

  const index = tracker.current % queue.length;
  const post = queue[index];

  console.log(`\n📋 Queue position: ${index + 1}/${queue.length}`);
  console.log(`📝 Generating post: "${post.title}"`);
  console.log(`   Category: ${post.category}`);
  console.log(`   Keyword: ${post.keyword}`);
  console.log(`   Age Range: ${post.age}\n`);

  // Generate content
  const content = await generatePost(post);

  // Build MDX
  const mdx = buildMdx({
    title: post.title,
    category: post.category,
    age: post.age,
    content,
    keyword: post.keyword,
  });

  // Save file
  const slug = slugify(post.title, { lower: true, strict: true });
  const filePath = join(PROJECT_ROOT, "src", "content", "blog", `${slug}.mdx`);
  writeFileSync(filePath, mdx, "utf-8");
  console.log(`💾 Saved to: src/content/blog/${slug}.mdx`);

  // Update tracker
  tracker.current = (index + 1) % queue.length;
  saveTracker(tracker);
  console.log(`📊 Queue tracker updated: next position ${tracker.current}`);

  // Git add, commit, push
  try {
    console.log("\n🔄 Committing and pushing to GitHub...");
    execSync("git add .", { cwd: PROJECT_ROOT, stdio: "inherit" });
    execSync(`git commit -m "add: ${post.title}"`, { cwd: PROJECT_ROOT, stdio: "inherit" });
    execSync("git push origin main", { cwd: PROJECT_ROOT, stdio: "inherit" });
    console.log("✅ Pushed to origin/main");
  } catch (err) {
    console.error("⚠️  Git push failed. You may need to push manually.");
    console.error(err.message);
  }

  console.log("\n🎉 Done! Auto-post complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});