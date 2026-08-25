const SAFE_CHAIN = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_CONTRACT = /^[a-zA-Z0-9:_-]{3,128}$/;
const SAFE_TOKEN = /^[a-zA-Z0-9_-]{1,128}$/;

function keyOf(chainId, contract, tokenId) {
  if (!SAFE_CHAIN.test(chainId) || !SAFE_CONTRACT.test(contract) || !SAFE_TOKEN.test(tokenId)) {
    throw new Error("TOKEN_REFERENCE_INVALID");
  }
  return `${chainId}/${contract}/${tokenId}`;
}

export class TokenIndex {
  #byToken = new Map();
  #byAsset = new Map();

  bind({ chainId, contract, tokenId, assetId }) {
    const key = keyOf(chainId, contract, tokenId);
    if (this.#byToken.has(key)) throw new Error("TOKEN_ALREADY_BOUND");
    if (this.#byAsset.has(assetId)) throw new Error("ASSET_ALREADY_TOKENIZED");
    const record = Object.freeze({ chainId, contract, tokenId, assetId });
    this.#byToken.set(key, record);
    this.#byAsset.set(assetId, record);
    return record;
  }

  byToken(chainId, contract, tokenId) {
    return this.#byToken.get(keyOf(chainId, contract, tokenId)) ?? null;
  }

  byAsset(assetId) {
    return this.#byAsset.get(assetId) ?? null;
  }
}

