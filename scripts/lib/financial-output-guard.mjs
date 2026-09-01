/**
 * Identifier-shaped financial-output patterns shared by the repository gate and its tests.
 * Code-only patterns are never applied to ordinary documentation prose.
 */
export const FORBIDDEN_FINANCIAL_OUTPUT_PATTERNS = Object.freeze([
  {
    surface: 'code',
    label: 'valuation output',
    pattern: /\b(valuation|appraised_?value|appraisalValue)\b/i,
  },
  {
    surface: 'code',
    label: 'price output',
    pattern: /\b(price|marketPrice|market_price|priceFeed|price_feed|quotePrice)\b/i,
  },
  {
    surface: 'code',
    label: 'collateral output',
    pattern:
      /\b(ltv|loanToValue|loan_to_value|collateralRatio|collateral_ratio|liquidationPrice)\b/i,
  },
  {
    surface: 'code',
    label: 'yield or rate output',
    pattern: /\b(apr|apy|yieldRate|yield_rate|interestRate|interest_rate)\b/i,
  },
  {
    surface: 'code',
    label: 'credit output',
    pattern: /\b(creditScore|credit_score|creditworthiness)\b/i,
  },
  {
    surface: 'code',
    label: 'investment advice',
    pattern: /\b(investmentAdvice|investment_advice|suitableForInvestment)\b/i,
  },
  {
    surface: 'all',
    label: 'prohibited public claim',
    pattern: /\bsec[ -](approved|certified)\b/i,
  },
  {
    surface: 'all',
    label: 'prohibited public claim',
    pattern: /\bguaranteed (return|liquidity|yield|appreciation)\b/i,
  },
]);

export function matchFinancialOutputLine(line, { codeSurface }) {
  return FORBIDDEN_FINANCIAL_OUTPUT_PATTERNS.filter(
    ({ surface, pattern }) => (surface === 'all' || codeSurface === true) && pattern.test(line),
  ).map(({ surface, label }) => ({ surface, label }));
}
