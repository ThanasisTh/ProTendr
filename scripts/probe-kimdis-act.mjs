// Temporary: confirm whether a "request" (αίτημα) reference number - the
// type linked to a notice via approvedRequests[].code, e.g. "26REQ..." -
// resolves on the same public detail URL used for notices ("...PROC...").
// Delete after use.

const REQ_CODE = "26REQ019599899"; // known-real, linked to notice 26PROC019601876 (approvedRequests)
const url = `https://cerpp.eprocurement.gov.gr/upgkimdis/unprotected/home.xhtml?referenceNumber=${REQ_CODE}`;

const res = await fetch(url);
const text = await res.text();
console.log(`status: ${res.status}, length: ${text.length}`);
console.log(`contains code: ${text.includes(REQ_CODE)}`);
console.log("snippet around title:", text.slice(0, 400).replace(/\s+/g, " "));

// Also fetch a fresh notice to check the approvedRequests / other relation
// fields are still present in the shape we expect.
const notices = await (
  await fetch("https://cerpp.eprocurement.gov.gr/khmdhs-opendata/notice?page=0&size=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cpvItems: ["72000000-5"], dateFrom: "2026-07-01", dateTo: "2026-08-11" }),
  })
).json();
const n = notices.content?.[0];
console.log("\nrelation fields on a fresh notice:");
console.log("referenceNumber:", n?.referenceNumber);
console.log("approvedRequests:", JSON.stringify(n?.approvedRequests));
console.log("relatedNoticeADAM:", JSON.stringify(n?.relatedNoticeADAM));
console.log("amendedNoticeADAM:", JSON.stringify(n?.amendedNoticeADAM));
console.log("frameworkAgreementNoticeADAM:", JSON.stringify(n?.frameworkAgreementNoticeADAM));
