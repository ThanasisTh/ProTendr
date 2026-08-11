// One-off diagnostic: probe the real POST /notice endpoint to learn the
// actual response item shape (the OpenAPI spec only says "content: object[]",
// Swagger couldn't infer the concrete type) and to confirm the CPV code
// format the API actually accepts. Delete this file once the real fetch
// script is built and confirmed working.

const BASE = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata";

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

const today = new Date();
const monthAgo = new Date(today);
monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);

const attempts = [
  {
    label: "bare 8-digit CPV",
    body: { cpvItems: ["72000000"], dateFrom: fmtDate(monthAgo), dateTo: fmtDate(today) },
  },
  {
    label: "CPV with check digit",
    body: { cpvItems: ["72000000-5"], dateFrom: fmtDate(monthAgo), dateTo: fmtDate(today) },
  },
  {
    label: "no cpv filter, date range only",
    body: { dateFrom: fmtDate(monthAgo), dateTo: fmtDate(today) },
  },
];

for (const { label, body } of attempts) {
  const url = `${BASE}/notice?page=0&size=3`;
  console.log(`\n=== POST /notice (${label}) ===`);
  console.log("request body:", JSON.stringify(body));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`status: ${res.status}`);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      console.log("non-JSON body (first 800 chars):", text.slice(0, 800));
      continue;
    }
    if (res.ok) {
      console.log(`totalElements: ${json.totalElements}, content length: ${json.content?.length}`);
      if (json.content?.[0]) {
        console.log("first content item:", JSON.stringify(json.content[0], null, 2));
      }
    } else {
      console.log("error body:", JSON.stringify(json, null, 2));
    }
  } catch (err) {
    console.log(`fetch error: ${err.message}`);
  }
}
