const SUBJECT_COMPLIANCE_KEYS = /^(kyc|aml|sanction|suitability|accredit|jurisdictionEligibility|licenseEligibility)$/i;
const FINANCIAL_OUTPUT_KEYS = /^(valuation|marketPrice|pricePrediction|collateralRatio|liquidationPrice|creditScore|interestRate|yieldRate|liquidityCurve|investmentAdvice)$/i;

function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

export function assertAssetFactsOnly(payload) {
  walk(payload, (key) => {
    if (SUBJECT_COMPLIANCE_KEYS.test(key)) throw new Error("SUBJECT_COMPLIANCE_OUT_OF_SCOPE");
    if (FINANCIAL_OUTPUT_KEYS.test(key)) throw new Error("FINANCIAL_OUTPUT_PROHIBITED");
  });
  return payload;
}

export function assertOneToOneIssuanceRequest(request) {
  assertAssetFactsOnly(request);
  if (request?.quantity !== 1 || request?.fractional === true || request?.sharedClaim === true) {
    throw new Error("ONE_ASSET_ONE_TOKEN_REQUIRED");
  }
  const required = ["assetRegistered", "authorityConfirmed", "warehouseReceiptValid", "certificateValid", "encumbranceClear", "walletBindingValid", "assetUnoccupied"];
  for (const field of required) if (request?.[field] !== true) throw new Error(`ISSUANCE_PREREQUISITE_MISSING:${field}`);
  return true;
}
