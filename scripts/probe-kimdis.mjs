// One-off diagnostic: the CPV check digit (the "-N" suffix KIMDIS requires)
// has no reliable public lookup - even the EU's own published check-digit
// formula is known-broken (fails on ~98% of codes per OP-TED/ePO#589). So
// brute-force all 10 digits per 8-digit code against the real API and see
// which one actually returns matches; a wrong digit should return zero
// since it doesn't correspond to any notice's real CPV key.

const BASE = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata";

const CODES = ["72000000", "72200000", "72212000", "72224000", "72413000", "72316000"];

const today = new Date();
const sixMonthsAgo = new Date(today);
sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
const dateFrom = sixMonthsAgo.toISOString().slice(0, 10);
const dateTo = today.toISOString().slice(0, 10);

for (const code of CODES) {
  console.log(`\n=== ${code} ===`);
  for (let digit = 0; digit <= 9; digit++) {
    const cpv = `${code}-${digit}`;
    const res = await fetch(`${BASE}/notice?page=0&size=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ cpvItems: [cpv], dateFrom, dateTo }),
    });
    if (!res.ok) {
      console.log(`  ${cpv}: HTTP ${res.status}`);
      continue;
    }
    const json = await res.json();
    if (json.totalElements > 0) {
      console.log(`  ${cpv}: totalElements=${json.totalElements}  <-- MATCH`);
      console.log(`    sample title: ${json.content?.[0]?.title}`);
    } else {
      console.log(`  ${cpv}: 0`);
    }
  }
}
