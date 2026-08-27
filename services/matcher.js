const Fuse = require("fuse.js");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


async function fetchAllRows(buildQuery) {
  const PAGE_SIZE = 1000;
  let allRows = [];
  let page = 0;
  while (true) {
    const { data, error } = await buildQuery().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    allRows = allRows.concat(data);
    if (!data || data.length < PAGE_SIZE) break;
    page++;
  }
  return allRows;
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"') 
    .replace(/[\u2013\u2014]/g, "-")  
    .replace(/\s+/g, " ") 
    .trim();
}

function buildFuseIndex(downloadedForms) {
  const prepared = downloadedForms.map(f => ({
    ...f,
    _normalized_name: normalizeText(f.form_name),
    _normalized_text: normalizeText(f.first_page_text),
  }));

  return new Fuse(prepared, {
    keys: [
      { name: "_normalized_name", weight: 0.7 },
      { name: "_normalized_text", weight: 0.3 },
    ],
    includeScore: true,
    threshold: 0.6,
    ignoreLocation: true,
  });
}

async function matchAgency(agencyName) {
  console.log(`\n>>> Matching forms for ${agencyName}...`);

  const csvForms = await fetchAllRows(() =>
    supabase.from("agency_csv_forms").select("*").eq("agency", agencyName)
  );

  const downloadedForms = await fetchAllRows(() =>
    supabase
      .from("form_hashes")
      .select("*")
      .eq("agency", agencyName)
      .in("extraction_status", ["success", "empty"])
  );

  console.log(`${csvForms.length} CSV rows vs ${downloadedForms.length} downloaded forms`);

  if (downloadedForms.length === 0) {
    console.log("No downloaded forms to match against — skipping.");
    return;
  }

  const fuse = buildFuseIndex(downloadedForms);
  const results = [];

  for (const csvRow of csvForms) {
    const matches = fuse.search(normalizeText(csvRow.description));
    const best = matches[0];

    let status = "unmatched";
    let confidence = 0;
    let matchedForm = null;

    if (best) {
      confidence = Math.round((1 - best.score) * 100);
      matchedForm = best.item;
      status = confidence >= 95 ? "auto_matched" : confidence >= 35 ? "needs_review" : "unmatched";
    }

    results.push({
      agency: agencyName,
      csv_form_id: csvRow.id,
      csv_description: csvRow.description,
      form_hash_id: matchedForm?.id ?? null,
      matched_form_name: matchedForm?.form_name ?? null,
      matched_file_name: matchedForm?.file_name ?? null,
      confidence,
      status,
    });
  }

  const UPSERT_BATCH_SIZE = 500;
  for (let i = 0; i < results.length; i += UPSERT_BATCH_SIZE) {
    const batch = results.slice(i, i + UPSERT_BATCH_SIZE);
    const { error: upsertError } = await supabase
      .from("form_matches")
      .upsert(batch, { onConflict: "csv_form_id" });
    if (upsertError) {
      console.error(`Failed to save batch ${i / UPSERT_BATCH_SIZE + 1}:`, upsertError.message);
    }
  }

  const autoCount = results.filter(r => r.status === "auto_matched").length;
  const reviewCount = results.filter(r => r.status === "needs_review").length;
  const unmatchedCount = results.filter(r => r.status === "unmatched").length;

  console.log(`✅ ${autoCount} auto-matched | 👀 ${reviewCount} need review | ❌ ${unmatchedCount} unmatched`);
}

module.exports = { matchAgency };