// Temporary: look for a real public detail-page URL for a KIMDIS notice.
// Delete after use. Strategy: fetch the full API help page (truncated to
// 1500 chars in an earlier probe, this time in full) and grep for any
// hrefs/patterns hinting at a public viewer, then try a few plausible
// candidate URLs against a real reference number and see which (if any)
// actually renders that notice.

const REAL_REF = "26PROC019601876"; // known-real from earlier probe output

const res = await fetch("https://cerpp.eprocurement.gov.gr/khmdhs-opendata/help");
const html = await res.text();
console.log(`help page: ${html.length} chars`);
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
console.log("hrefs found:", JSON.stringify([...new Set(hrefs)]));
const mentions = [...html.matchAll(/.{40}(referenceNumber|ΑΔΑΜ|adam|promitheus|public).{40}/gi)].map((m) => m[0]);
console.log("context mentions:", JSON.stringify(mentions.slice(0, 20), null, 2));

const candidates = [
  `https://cerpp.eprocurement.gov.gr/upgkimdis/unprotected/home.xhtml?referenceNumber=${REAL_REF}`,
  `https://cerpp.eprocurement.gov.gr/kimdisPublic/?referenceNumber=${REAL_REF}`,
  `https://promitheus.gov.gr/webcenter/portal/EPPS/pages_dds?_afrLoop=1&referenceNumber=${REAL_REF}`,
  `https://cerpp.eprocurement.gov.gr/upgkimdis/faces/anonymous/searchAdvertisement?referenceNumber=${REAL_REF}`,
];

for (const url of candidates) {
  console.log(`\n=== ${url} ===`);
  try {
    const r = await fetch(url, { redirect: "follow" });
    const text = await r.text();
    console.log(`status: ${r.status}, final url: ${r.url}, length: ${text.length}`);
    console.log(`contains reference number: ${text.includes(REAL_REF)}`);
    console.log("snippet:", text.slice(0, 300).replace(/\s+/g, " "));
  } catch (err) {
    console.log(`error: ${err.message}`);
  }
}
