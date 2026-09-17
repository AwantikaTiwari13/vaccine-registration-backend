/**
 * Aadhaar numbers are personally identifiable and are never returned in full by
 * any API. They are stored with `select: false` so they cannot leak by
 * accident, and this helper is used wherever a partial value is genuinely
 * useful (the owner confirming which Aadhaar is on file).
 */
function maskAadhar(aadharNo) {
  if (typeof aadharNo !== "string" || aadharNo.length < 4) return null;
  return `${"X".repeat(aadharNo.length - 4)}${aadharNo.slice(-4)}`;
}

module.exports = { maskAadhar };
