#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");
const BLOG_DIR = join(PROJECT_ROOT, "src", "content", "blog");
const AFFILIATE_TAG = "funwithkidsbo-20";

// --------------- Load product database ---------------
function loadProducts() {
  const productsPath = join(__dirname, "affiliate-products.json");
  const data = JSON.parse(readFileSync(productsPath, "utf-8"));

  // Flatten all products into a single array with their category group
  const allProducts = [];
  for (const [group, products] of Object.entries(data)) {
    for (const product of products) {
      allProducts.push({ ...product, group });
    }
  }
  console.log(`📦 Loaded ${allProducts.length} products from ${Object.keys(data).length} categories`);
  return allProducts;
}

// --------------- Match product to description ---------------
function findBestProduct(description, allProducts) {
  const descLower = description.toLowerCase();
  const descWords = descLower.split(/\s+/);

  let bestMatch = null;
  let bestScore = 0;

  for (const product of allProducts) {
    let score = 0;

    // Check keyword matches
    for (const keyword of product.keywords) {
      if (descLower.includes(keyword.toLowerCase())) {
        score += 3; // Strong match for keyword phrase
      }
      // Check individual words in the keyword
      const keywordWords = keyword.toLowerCase().split(/\s+/);
      for (const kw of keywordWords) {
        if (descWords.includes(kw)) {
          score += 1;
        }
      }
    }

    // Check product name words
    const nameWords = product.name.toLowerCase().split(/\s+/);
    for (const nw of nameWords) {
      if (nw.length > 3 && descLower.includes(nw)) {
        score += 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  }

  return { product: bestMatch, score: bestScore };
}

// --------------- Generate ProductCard component ---------------
function generateProductCard(product, description) {
  const affiliateUrl = `https://amazon.com/dp/${product.asin}?tag=${AFFILIATE_TAG}`;
  return `<ProductCard
  name="${product.name}"
  description="${description.trim()}"
  rating={4}
  imageUrl="https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=400&h=400&fit=crop"
  affiliateUrl="${affiliateUrl}"
  price="Check Price"
  badge="Recommended"
/>`;
}

// --------------- Process a single MDX file ---------------
function processFile(filePath, allProducts) {
  const content = readFileSync(filePath, "utf-8");
  const fileName = filePath.split("/").pop();

  // Find all PRODUCT_CARD placeholders
  const placeholderRegex = /<!--\s*PRODUCT_CARD:\s*(.+?)\s*-->/g;
  const matches = [...content.matchAll(placeholderRegex)];

  if (matches.length === 0) {
    return { modified: false, replacements: 0 };
  }

  console.log(`\n📄 ${fileName}: Found ${matches.length} PRODUCT_CARD placeholder(s)`);

  let newContent = content;
  let replacements = 0;
  const usedProducts = new Set(); // Avoid duplicates in same file

  // Check if import already exists
  const hasImport = content.includes("import ProductCard");

  for (const match of matches) {
    const fullMatch = match[0];
    const description = match[1];

    console.log(`   🔍 Matching: "${description}"`);

    const { product, score } = findBestProduct(description, allProducts);

    if (product && score >= 2 && !usedProducts.has(product.asin)) {
      console.log(`   ✅ Matched: "${product.name}" (score: ${score})`);
      const card = generateProductCard(product, description);
      newContent = newContent.replace(fullMatch, card);
      usedProducts.add(product.asin);
      replacements++;
    } else if (product) {
      console.log(`   ⚠️ Best match "${product.name}" (score: ${score}) — too low or duplicate, keeping placeholder`);
    } else {
      console.log(`   ❌ No matching product found — keeping placeholder`);
    }
  }

  // Add import if we made replacements and it's not already there
  if (replacements > 0 && !hasImport) {
    // Find end of frontmatter
    const frontmatterEnd = newContent.indexOf("---", newContent.indexOf("---") + 3);
    if (frontmatterEnd !== -1) {
      const insertPos = frontmatterEnd + 3;
      newContent =
        newContent.substring(0, insertPos) +
        "\n\nimport ProductCard from '../../components/ProductCard.astro';" +
        newContent.substring(insertPos);
      console.log(`   📎 Added ProductCard import`);
    }
  }

  if (replacements > 0) {
    writeFileSync(filePath, newContent, "utf-8");
  }

  return { modified: replacements > 0, replacements };
}

// --------------- Main ---------------
function main() {
  console.log("\n🔗 === Affiliate Link Inserter ===\n");

  const allProducts = loadProducts();

  // Get all MDX files
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx"));
  console.log(`📂 Found ${files.length} blog posts to scan\n`);

  let totalReplacements = 0;
  let modifiedFiles = 0;

  for (const file of files) {
    const filePath = join(BLOG_DIR, file);
    const { modified, replacements } = processFile(filePath, allProducts);
    if (modified) {
      modifiedFiles++;
      totalReplacements += replacements;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Files scanned: ${files.length}`);
  console.log(`   Files modified: ${modifiedFiles}`);
  console.log(`   Placeholders replaced: ${totalReplacements}`);

  if (totalReplacements === 0) {
    console.log("\n📭 No placeholders were replaced. Products may not match or all placeholders already processed.");
  } else {
    console.log(`\n✅ Replaced ${totalReplacements} placeholder(s) with ProductCard components.`);
    console.log(`⚠️ Remember to replace "${AFFILIATE_TAG}" with your real Amazon Associates tag once approved.`);
  }

  console.log("\n🎉 Affiliate insertion complete!\n");
}

main();