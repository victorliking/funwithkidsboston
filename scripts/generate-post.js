#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import slugify from "slugify";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

// --------------- Parse CLI args ---------------
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    const value = args[i + 1];
    if (!value) {
      console.error(`Missing value for --${key}`);
      process.exit(1);
    }
    parsed[key] = value;
  }
  return parsed;
}

const VALID_CATEGORIES = ["things-to-do", "day-trips", "gear-reviews", "seasonal"];

const CATEGORY_IMAGE_KEYWORDS = {
  "things-to-do": "children,boston,family",
  "day-trips": "family,travel,children",
  "gear-reviews": "kids,outdoor,gear",
  "seasonal": "family,seasons,children",
};

const CATEGORY_DISPLAY_NAMES = {
  "things-to-do": "Things To Do",
  "day-trips": "Day Trips",
  "gear-reviews": "Gear & Reviews",
  "seasonal": "Seasonal Guides",
};

function validateArgs(args) {
  if (!args.title) {
    console.error('Error: --title is required');
    process.exit(1);
  }
  if (!args.category || !VALID_CATEGORIES.includes(args.category)) {
    console.error(`Error: --category must be one of: ${VALID_CATEGORIES.join(", ")}`);
    process.exit(1);
  }
  if (!args.keyword) {
    console.error('Error: --keyword is required');
    process.exit(1);
  }
  if (!args.age) {
    console.error('Error: --age is required (e.g. "2-5", "3-8", "all ages")');
    process.exit(1);
  }
}

// --------------- Generate content via Claude ---------------
async function generatePost({ title, category, keyword, age }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    console.error("Set it with: export ANTHROPIC_API_KEY=your_key_here");
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
  {/* PRODUCT_CARD: [brief product description relevant to context] */}
  {/* ACTIVITY_CARD: [activity name relevant to context] */}
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

  // Generate description (max 150 chars)
  const firstParagraph = content.split("\n").find((line) => line.trim().length > 50) || "";
  let description = firstParagraph.replace(/[#*\[\]]/g, "").trim();
  if (description.length > 150) {
    description = description.substring(0, 147) + "...";
  }

  // Generate tags from keyword and category
  const tags = [
    ...new Set([
      keyword.toLowerCase(),
      category,
      "boston",
      "kids",
      ...keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    ]),
  ];

  const displayCategory = CATEGORY_DISPLAY_NAMES[category] || "Things To Do";

  const frontmatter = `---
title: "${title}"
description: "${description}"
pubDate: ${today}
heroImage: "${heroImage}"
category: "${displayCategory}"
ageRange: "${age}"
tags: [${tags.map((t) => `"${t}"`).join(", ")}]
affiliateDisclosure: true
---`;

  return `${frontmatter}\n\n${content}\n`;
}

// --------------- Main ---------------
async function main() {
  const args = parseArgs();
  validateArgs(args);

  const { title, category, keyword, age } = args;

  console.log(`\n📝 Generating post: "${title}"`);
  console.log(`   Category: ${category}`);
  console.log(`   Keyword: ${keyword}`);
  console.log(`   Age Range: ${age}\n`);

  // Generate content
  const content = await generatePost({ title, category, keyword, age });

  // Build MDX
  const mdx = buildMdx({ title, category, age, content, keyword });

  // Generate slug and save file
  const slug = slugify(title, { lower: true, strict: true });
  const filePath = join(PROJECT_ROOT, "src", "content", "blog", `${slug}.mdx`);

  writeFileSync(filePath, mdx, "utf-8");
  console.log(`💾 Saved to: src/content/blog/${slug}.mdx`);

  // Git add, commit, push
  try {
    console.log("\n🔄 Committing and pushing to GitHub...");
    execSync("git add .", { cwd: PROJECT_ROOT, stdio: "inherit" });
    execSync(`git commit -m "add: ${title}"`, { cwd: PROJECT_ROOT, stdio: "inherit" });
    execSync("git push origin main", { cwd: PROJECT_ROOT, stdio: "inherit" });
    console.log("✅ Pushed to origin/main");
  } catch (err) {
    console.error("⚠️  Git push failed. You may need to push manually.");
    console.error(err.message);
  }

  console.log("\n🎉 Done! Your new post is ready.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});