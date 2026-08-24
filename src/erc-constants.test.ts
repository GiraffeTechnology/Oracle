import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatSelector,
  functionSelector,
  interfaceId,
  keccak256,
  parseInterfaceSignatures,
  toHex,
} from './erc-constants.ts';

describe('keccak256', () => {
  it('matches published test vectors', () => {
    assert.equal(
      toHex(keccak256(new Uint8Array(0))),
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
    assert.equal(
      toHex(keccak256(new TextEncoder().encode('abc'))),
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });

  it('handles input spanning multiple sponge blocks', () => {
    // 200 bytes exceeds the 136-byte rate, exercising the absorb loop.
    const digest = keccak256(new Uint8Array(200).fill(0xab));
    assert.equal(digest.length, 32);
    assert.notEqual(toHex(digest), toHex(keccak256(new Uint8Array(199).fill(0xab))));
  });
});

describe('ABI selectors', () => {
  it('derives well-known selectors', () => {
    assert.equal(formatSelector(functionSelector('transfer(address,uint256)')), '0xa9059cbb');
    assert.equal(formatSelector(functionSelector('supportsInterface(bytes4)')), '0x01ffc9a7');
  });

  it('derives the canonical ERC-721 interface ID', () => {
    const erc721 = [
      'balanceOf(address)',
      'ownerOf(uint256)',
      'safeTransferFrom(address,address,uint256,bytes)',
      'safeTransferFrom(address,address,uint256)',
      'transferFrom(address,address,uint256)',
      'approve(address,uint256)',
      'setApprovalForAll(address,bool)',
      'getApproved(uint256)',
      'isApprovedForAll(address,address)',
    ];
    assert.equal(formatSelector(interfaceId(erc721)), '0x80ac58cd');
  });

  it('derives the ERC-8325 IAssetBoundTokenId interface ID', () => {
    const signatures = ['anchorIdOf(uint256)', 'anchorRegistry()', 'isAnchorActiveFor(uint256)'];
    assert.equal(formatSelector(interfaceId(signatures)), '0x4a967b01');
  });
});

describe('interface parsing', () => {
  const source = `
interface IExample is IERC165 {
    struct Ignored { uint256 value; }

    event Ignored(uint256 indexed a, bytes32 b);

    function alpha(uint256 tokenId)
        external view returns (bytes32 result);

    function beta(
        bytes32 id,
        address to,
        uint64 deadline
    ) external;
}
`;

  it('collects canonical signatures and drops parameter names', () => {
    assert.deepEqual(parseInterfaceSignatures(source, 'IExample'), [
      'alpha(uint256)',
      'beta(bytes32,address,uint64)',
    ]);
  });

  it('fails loudly when the interface is absent', () => {
    assert.throws(() => parseInterfaceSignatures(source, 'IMissing'), /IMissing not found/);
  });
});
