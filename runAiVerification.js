const path = require("path");
const Fuse = require("fuse.js");
const { createClient } = require("@supabase/supabase-js");
const { verifyWithAI } = require("./services/AiVerifier");

require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAiVerification(agencyName) {
  console.log(`\n>>> AI-verifying needs_review matches for ${agencyName}...`);

  const { data: reviewRows, error: reviewError } = await supabase
    .from("form_matches")
    .select("*")
    .eq("agency", agencyName)
    .eq("status", "needs_review")
    .is("ai_verdict", null);

  if (reviewError) {
    console.error("Failed to load review rows:", reviewError.message);
    return;
  }

  console.log(`${reviewRows.length} rows need AI verification`);
  if (reviewRows.length === 0) return;

  const { data: downloadedForms, error: formsError } = await supabase
    .from("form_hashes")
    .select("*")
    .eq("agency", agencyName)
    .in("extraction_status", ["success", "empty"]);

  if (formsError) {
    console.error("Failed to load downloaded forms:", formsError.message);
    return;
  }

  const fuse = new Fuse(downloadedForms, {
    keys: [{ name: "form_name", weight: 0.7 }, { name: "first_page_text", weight: 0.3 }],
    includeScore: true,
    threshold: 0.6,
    ignoreLocation: true,
  });

  for (const row of reviewRows) {
    const candidates = fuse.search(row.csv_description).slice(0, 3).map(r => r.item);

    if (candidates.length === 0) {
      console.log(`  No candidates for "${row.csv_description}" — skipping`);
      continue;
    }

    try {
      const result = await verifyWithAI(row.csv_description, candidates);

      const update = {
        ai_verdict: result.verdict,
        ai_confidence: result.confidence,
        ai_reasoning: result.reasoning,
      };

      if (result.verdict === "matched") {
        const matched = candidates[result.matchedIndex];
        update.status = "ai_matched";
        update.form_hash_id = matched.id;
        update.matched_form_name = matched.form_name;
        update.matched_file_name = matched.file_name;
      }

      const { error: updateError } = await supabase
        .from("form_matches")
        .update(update)
        .eq("id", row.id);

      if (updateError) {
        console.error(`  Failed to update row ${row.id}:`, updateError.message);
      } else {
        console.log(`  "${row.csv_description}" -> ${result.verdict} (${result.confidence})`);
      }
    } catch (err) {
      console.error(`  AI call failed for "${row.csv_description}":`, err.message);
    }

    await delay(2500);
  }

  console.log(`>>> Done AI-verifying ${agencyName}`);
}

module.exports = { runAiVerification };

if (require.main === module) {
  const agencyName = process.argv[2] || "Insurance Commission (IC)";
  runAiVerification(agencyName);
}