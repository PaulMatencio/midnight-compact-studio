import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-2/contract/index.js';

type PrivateState = {
  currentSecretKey: Uint8Array;
};

describe('FungibleToken Contract (fungible-token-v2-2)', () => {
  const dummyContractAddress = '00'.repeat(32);
  const dummyCoinPublicKey = '01'.repeat(32);
  const dummyAddressBytes = Uint8Array.from(Buffer.from(dummyContractAddress, 'hex'));

  const MAX_UINT128 = 340282366920938463463374607431768211455n;

  // Key creation helpers
  const createKey = (byteVal: number): Uint8Array => new Uint8Array(32).fill(byteVal);
  const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);

  // Secret keys for distinct actors
  const OWNER_SK = createKey(1);
  const ALICE_SK = createKey(2);
  const BOB_SK = createKey(3);
  const CHARLIE_SK = createKey(4);
  const UNAUTHORIZED_SK = createKey(99);

  // Helper instance to access compiled persistentHash
  const helperContract = new Contract({
    localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
  });

  const pad32 = (str: string): Uint8Array => {
    const bytes = new Uint8Array(32);
    const encoded = new TextEncoder().encode(str);
    bytes.set(encoded);
    return bytes;
  };

  const domainTag = pad32('fungible-token:auth');

  // Derive account identity according to authenticate() circuit
  const deriveAccount = (sk: Uint8Array): Uint8Array => {
    const c = helperContract as any;
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(c)).concat(Object.keys(c))) {
      if (key.startsWith('_persistentHash')) {
        try {
          const res = c[key]([domainTag, { bytes: dummyAddressBytes }, sk]);
          if (res instanceof Uint8Array && res.length === 32) {
            return res;
          }
        } catch {
          // Continue searching for matching hash method
        }
      }
    }
    if (typeof c._persistentHash_0 === 'function') {
      return c._persistentHash_0([domainTag, { bytes: dummyAddressBytes }, sk]);
    }
    throw new Error('Unable to find persistentHash method on Contract');
  };

  // Derived public account identities
  let OWNER: Uint8Array;
  let ALICE: Uint8Array;
  let BOB: Uint8Array;
  let CHARLIE: Uint8Array;
  let UNAUTHORIZED: Uint8Array;

  const TOKEN_NAME = 'Midnight Token';
  const TOKEN_SYMBOL = 'MDT';
  const TOKEN_DECIMALS = 18n;

  let privateState: PrivateState;
  let contract: Contract<PrivateState>;
  let circuitContext: any;

  const witnesses: Witnesses<PrivateState> = {
    localSecretKey: ({ privateState }: CompactRuntime.WitnessContext<any, PrivateState>) => {
      return [privateState, privateState.currentSecretKey];
    },
  };

  const setCallerSecretKey = (sk: Uint8Array) => {
    privateState = { currentSecretKey: sk };
    if (circuitContext) {
      circuitContext.currentPrivateState = privateState;
    }
  };

  const runCircuit = (circuitFn: (...args: any[]) => any, ...args: any[]) => {
    if (circuitContext) {
      circuitContext.currentPrivateState = privateState;
    }
    const normalizedArgs = args.map((arg) => (typeof arg === 'number' ? BigInt(arg) : arg));
    const result = circuitFn(circuitContext, ...normalizedArgs);
    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      result.context.currentQueryContext.state,
      privateState
    );
    return result.result;
  };

  beforeEach(() => {
    OWNER = deriveAccount(OWNER_SK);
    ALICE = deriveAccount(ALICE_SK);
    BOB = deriveAccount(BOB_SK);
    CHARLIE = deriveAccount(CHARLIE_SK);
    UNAUTHORIZED = deriveAccount(UNAUTHORIZED_SK);

    privateState = { currentSecretKey: OWNER_SK };
    contract = new Contract(witnesses);

    const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
    const { currentContractState } = contract.initialState(
      constructorCtx,
      OWNER,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_DECIMALS
    );

    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      currentContractState.data,
      privateState
    );
  });

  describe('Initialization & Metadata', () => {
    it('should initialize token metadata correctly', () => {
      const name = runCircuit(contract.circuits.name);
      const symbol = runCircuit(contract.circuits.symbol);
      const decimals = runCircuit(contract.circuits.decimals);
      const totalSupply = runCircuit(contract.circuits.totalSupply);

      expect(name).toBe(TOKEN_NAME);
      expect(symbol).toBe(TOKEN_SYMBOL);
      expect(decimals).toBe(18n);
      expect(Number(decimals)).toBe(18);
      expect(totalSupply).toBe(0n);
    });

    it('should return 0 balance for uninitialized accounts', () => {
      const balance = runCircuit(contract.circuits.balanceOf, ALICE);
      expect(balance).toBe(0n);
    });

    it('should return 0 allowance for unset allowances', () => {
      const allow = runCircuit(contract.circuits.allowance, ALICE, BOB);
      expect(allow).toBe(0n);
    });

    it('should match state parsed via ledger() accessor', () => {
      const state = ledger(circuitContext.currentQueryContext.state);
      expect(state._name).toBe(TOKEN_NAME);
      expect(state._symbol).toBe(TOKEN_SYMBOL);
      expect(state._decimals).toBe(18n);
      expect(state._totalSupply).toBe(0n);
      expect(state.owner).toEqual(OWNER);
    });
  });

  describe('Minting', () => {
    it('should allow owner to mint tokens to an account', () => {
      setCallerSecretKey(OWNER_SK);
      const minted = runCircuit(contract.circuits.mint, ALICE, 1_000n);
      expect(minted).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(1_000n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(1_000n);
    });

    it('should fail when non-owner attempts to mint', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, ALICE, 1_000n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail when minting to zeroKey', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, zeroKey(), 1_000n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail when minting causes supply overflow', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE, MAX_UINT128);

      expect(() => {
        runCircuit(contract.circuits.mint, ALICE, 1n);
      }).toThrow('FungibleToken: supply overflow');
    });
  });

  describe('Transfers', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE, 1_000n);
    });

    it('should transfer tokens between accounts', () => {
      setCallerSecretKey(ALICE_SK);
      const tx = runCircuit(contract.circuits.transfer, ALICE, BOB, 400n);
      expect(tx).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(600n);
      expect(runCircuit(contract.circuits.balanceOf, BOB)).toBe(400n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(1_000n);
    });

    it('should handle self-transfers successfully without balance change', () => {
      setCallerSecretKey(ALICE_SK);
      const tx = runCircuit(contract.circuits.transfer, ALICE, ALICE, 300n);
      expect(tx).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(1_000n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(1_000n);
    });

    it('should fail self-transfer when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, ALICE, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail transfer when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, BOB, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail transfer from caller with wrong secret key authentication', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, BOB, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail transfer to zeroKey', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, zeroKey(), 100n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail transfer when sender is zeroKey', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, zeroKey(), BOB, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('Approvals & Allowances', () => {
    it('should allow account to approve spender allowance', () => {
      setCallerSecretKey(ALICE_SK);
      const approved = runCircuit(contract.circuits.approve, ALICE, BOB, 500n);
      expect(approved).toBe(true);

      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(500n);
    });

    it('should overwrite previous allowance on subsequent approve call', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 500n);
      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(500n);

      runCircuit(contract.circuits.approve, ALICE, BOB, 200n);
      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(200n);
    });

    it('should fail approve when caller does not match secret key', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE, BOB, 500n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail approve when spender is zeroKey', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE, zeroKey(), 500n);
      }).toThrow('FungibleToken: invalid spender');
    });

    it('should fail approve when owner is zeroKey', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, zeroKey(), BOB, 500n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('TransferFrom', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE, 1_000n);

      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 500n);
    });

    it('should allow approved spender to transfer tokens from owner', () => {
      setCallerSecretKey(BOB_SK);
      const tx = runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 300n);
      expect(tx).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(700n);
      expect(runCircuit(contract.circuits.balanceOf, CHARLIE)).toBe(300n);
      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(200n);
    });

    it('should allow spending full allowance', () => {
      setCallerSecretKey(BOB_SK);
      const tx = runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 500n);
      expect(tx).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(500n);
      expect(runCircuit(contract.circuits.balanceOf, CHARLIE)).toBe(500n);
      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(0n);
    });

    it('should not deduct allowance when allowance is MAX_UINT128 (infinite allowance pattern)', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, MAX_UINT128);

      setCallerSecretKey(BOB_SK);
      runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 400n);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(600n);
      expect(runCircuit(contract.circuits.balanceOf, CHARLIE)).toBe(400n);
      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(MAX_UINT128);
    });

    it('should fail transferFrom when spending more than allowed', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 501n);
      }).toThrow('FungibleToken: insufficient allowance');
    });

    it('should fail transferFrom when owner balance is insufficient even if allowance is sufficient', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 2_000n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 1_500n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail transferFrom when caller authentication fails', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 200n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail transferFrom to zeroKey receiver', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, zeroKey(), 200n);
      }).toThrow('FungibleToken: invalid receiver');
    });
  });

  describe('Burning', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE, 1_000n);
    });

    it('should allow token holder to burn their tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const burned = runCircuit(contract.circuits.burn, ALICE, 400n);
      expect(burned).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(600n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(600n);
    });

    it('should fail when burning more than balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, ALICE, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail burn when caller authentication fails', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, ALICE, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail burn when account is zeroKey', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, zeroKey(), 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('Boundary & Invariant Conditions', () => {
    it('should allow transfers of 0 tokens', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE, 500n);

      setCallerSecretKey(ALICE_SK);
      const tx = runCircuit(contract.circuits.transfer, ALICE, BOB, 0n);
      expect(tx).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(500n);
      expect(runCircuit(contract.circuits.balanceOf, BOB)).toBe(0n);
    });

    it('should maintain total supply invariant across multiple transfers and burns', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE, 2_000n);
      runCircuit(contract.circuits.mint, BOB, 3_000n);

      expect(runCircuit(contract.circuits.totalSupply)).toBe(5_000n);

      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.transfer, ALICE, CHARLIE, 500n);

      setCallerSecretKey(BOB_SK);
      runCircuit(contract.circuits.burn, BOB, 1_000n);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(1_500n);
      expect(runCircuit(contract.circuits.balanceOf, BOB)).toBe(2_000n);
      expect(runCircuit(contract.circuits.balanceOf, CHARLIE)).toBe(500n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(4_000n);
    });
  });
});