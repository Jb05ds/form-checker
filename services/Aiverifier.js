const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = "openai/gpt-oss-20b";

async function verifyWithAI(csvDescription, candidates) {
  const candidateList = candidates
    .map((c, i) => `${i + 1}. "${c.form_name}"`)
    .join("\n");

  const prompt = `You are verifying whether an official government form matches any of several candidate forms found by a web crawler. Titles may be worded differently but still refer to the same form.

Official form: "${csvDescription}"

Candidates:
${candidateList}

Reply with ONLY valid JSON, no other text:
{"match_index": <number or null>, "confidence": "high"|"medium"|"low", "reasoning": "<one short sentence>"}

match_index is the 1-based number of the candidate that is clearly the same form, or null if none of them are.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const raw = data.choices[0].message.content.trim();
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  if (parsed.match_index === null || parsed.match_index === undefined) {
    return { verdict: "no_match", matchedIndex: null, confidence: parsed.confidence, reasoning: parsed.reasoning };
  }

  return {
    verdict: "matched",
    matchedIndex: parsed.match_index - 1,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
  };
}

module.exports = { verifyWithAI };