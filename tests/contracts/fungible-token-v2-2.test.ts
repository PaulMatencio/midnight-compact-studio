import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-2/contract/index.js';

type PrivateState = {
  readonly currentSecretKey: Uint8Array;
};

describe('FungibleTokenV2_2 Contract Tests', () => {
  const dummyContractAddress = '00'.repeat(32);
  const dummyCoinPublicKey = '01'.repeat(32);
  const dummyAddressBytes = Uint8Array.from(Buffer.from(dummyContractAddress, 'hex'));

  const pad32 = (str: string): Uint8Array => {
    const res = new Uint8Array(32);
    const buf = Buffer.from(str, 'utf8');
    res.set(buf.subarray(0, 32));
    return res;
  };

  const createKey = (b: number): Uint8Array => new Uint8Array(32).fill(b);
  const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);

  const domainTagAuth = pad32('fungible-token:auth');

  // Secret keys for distinct test actors
  const OWNER_SK = createKey(1);
  const ALICE_SK = createKey(2);
  const BOB_SK = createKey(3);
  const CHARLIE_SK = createKey(4);
  const PAUSER_SK = createKey(5);
  const UNAUTHORIZED_SK = createKey(99);

  // Helper contract to dynamically locate and bind persistentHash for account derivation
  const helperContract = new Contract({
    localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
  });

  const proto = Object.getPrototypeOf(helperContract);
  const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
  const accountHashMethod =
    hashMethods.find((method) => {
      try {
        const t1 = (helperContract as any)[method]([domainTagAuth, { bytes: dummyAddressBytes }, createKey(1)]);
        const t2 = (helperContract as any)[method]([domainTagAuth, { bytes: dummyAddressBytes }, createKey(2)]);
        return t1 instanceof Uint8Array && t2 instanceof Uint8Array && Buffer.from(t1).compare(Buffer.from(t2)) !== 0;
      } catch {
        return false;
      }
    }) || '_persistentHash_0';

  const deriveAccount = (sk: Uint8Array): Uint8Array => {
    return (helperContract as any)[accountHashMethod]([domainTagAuth, { bytes: dummyAddressBytes }, sk]);
  };

  // Precomputed derived accounts
  const ownerAccount = deriveAccount(OWNER_SK);
  const aliceAccount = deriveAccount(ALICE_SK);
  const bobAccount = deriveAccount(BOB_SK);
  const charlieAccount = deriveAccount(CHARLIE_SK);
  const pauserAccount = deriveAccount(PAUSER_SK);
  const unauthorizedAccount = deriveAccount(UNAUTHORIZED_SK);

  const MAX_UINT128 = 340282366920938463463374607431768211455n;
  const INITIAL_MAX_SUPPLY = 1_000_000n;
  const TOKEN_NAME = 'Midnight Token';
  const TOKEN_SYMBOL = 'MDT';
  const TOKEN_DECIMALS = 18n;

  let currentCallerSecretKey: Uint8Array;
  let privateState: PrivateState;
  let contract: Contract<PrivateState>;
  let circuitContext: any;

  const setCallerSecretKey = (sk: Uint8Array) => {
    currentCallerSecretKey = sk;
    privateState = { currentSecretKey: sk };
    if (circuitContext) {
      circuitContext.currentPrivateState = privateState;
    }
  };

  const witnesses: Witnesses<PrivateState> = {
    localSecretKey: (ctx) => [
      ctx.privateState,
      ctx.privateState?.currentSecretKey ?? currentCallerSecretKey,
    ],
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

  const getLedger = () => ledger(circuitContext.currentQueryContext.state);

  const deployContract = (maxSupply: bigint = INITIAL_MAX_SUPPLY) => {
    currentCallerSecretKey = OWNER_SK;
    privateState = { currentSecretKey: OWNER_SK };
    contract = new Contract(witnesses);

    const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
    const { currentContractState } = contract.initialState(
      constructorCtx,
      ownerAccount,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_DECIMALS,
      maxSupply
    );

    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      currentContractState.data,
      privateState
    );
  };

  beforeEach(() => {
    deployContract();
  });

  describe('Contract Initialization & Metadata', () => {
    it('initializes token metadata correctly', () => {
      expect(runCircuit(contract.circuits.name)).toBe(TOKEN_NAME);
      expect(runCircuit(contract.circuits.symbol)).toBe(TOKEN_SYMBOL);
      expect(runCircuit(contract.circuits.decimals)).toBe(TOKEN_DECIMALS);
      expect(runCircuit(contract.circuits.maxSupply)).toBe(INITIAL_MAX_SUPPLY);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(0n);
      expect(runCircuit(contract.circuits.paused)).toBe(false);
    });

    it('sets default maxSupply to MAX_UINT128 when initialized with 0', () => {
      deployContract(0n);
      expect(runCircuit(contract.circuits.maxSupply)).toBe(MAX_UINT128);
    });

    it('initializes owner and accounts with zero balances and allowances', () => {
      expect(runCircuit(contract.circuits.balanceOf, ownerAccount)).toBe(0n);
      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(0n);
      expect(runCircuit(contract.circuits.allowance, ownerAccount, aliceAccount)).toBe(0n);
    });
  });

  describe('Authentication & Authorization', () => {
    it('fails when caller secret key does not correspond to provided account parameter', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, bobAccount, aliceAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('fails when unauthorized key attempts owner-only action', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, aliceAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('Minting', () => {
    it('allows owner to mint tokens to an account', () => {
      setCallerSecretKey(OWNER_SK);
      const success = runCircuit(contract.circuits.mint, aliceAccount, 500n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(500n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(500n);
    });

    it('fails when non-owner attempts to mint', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, aliceAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('fails when minting to the zero address', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, zeroKey(), 100n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('fails when minting exceeds max supply', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, aliceAccount, INITIAL_MAX_SUPPLY + 1n);
      }).toThrow('FungibleToken: supply overflow');
    });
  });

  describe('Transfers', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 1_000n);
    });

    it('allows token holders to transfer balances', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 400n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(600n);
      expect(runCircuit(contract.circuits.balanceOf, bobAccount)).toBe(400n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(1_000n);
    });

    it('allows self-transfers when balance is sufficient', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, aliceAccount, aliceAccount, 300n);
      expect(success).toBe(true);
      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(1_000n);
    });

    it('fails on self-transfer when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, aliceAccount, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('fails when transferring to zero address', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, zeroKey(), 100n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('fails when transferring more than current balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 1_500n);
      }).toThrow('FungibleToken: insufficient balance');
    });
  });

  describe('Approvals & Allowances', () => {
    it('allows account to approve spender allowance', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 500n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(500n);
    });

    it('fails approval when owner is zero address', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, zeroKey(), bobAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('fails approval when spender is zero address', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, aliceAccount, zeroKey(), 100n);
      }).toThrow('FungibleToken: invalid spender');
    });
  });

  describe('TransferFrom', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 1_000n);
    });

    it('allows spender to transfer tokens within approved allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 400n);

      setCallerSecretKey(BOB_SK);
      const success = runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 250n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(750n);
      expect(runCircuit(contract.circuits.balanceOf, charlieAccount)).toBe(250n);
      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(150n);
    });

    it('does not reduce allowance when set to MAX_UINT128 (infinite allowance)', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, MAX_UINT128);

      setCallerSecretKey(BOB_SK);
      runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 300n);

      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(MAX_UINT128);
      expect(runCircuit(contract.circuits.balanceOf, charlieAccount)).toBe(300n);
    });

    it('fails when transfer amount exceeds approved allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 200n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 201n);
      }).toThrow('FungibleToken: insufficient allowance');
    });

    it('fails when token owner has insufficient balance despite sufficient allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 2_000n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 1_500n);
      }).toThrow('FungibleToken: insufficient balance');
    });
  });

  describe('Burning', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 1_000n);
    });

    it('allows token holders to burn their tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.burn, aliceAccount, 400n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(600n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(600n);
    });

    it('fails when burning more than balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, aliceAccount, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('fails when burning with unauthenticated account', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, aliceAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('Emergency Stop (Pause / Unpause)', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 1_000n);
    });

    it('allows owner to pause and unpause the contract', () => {
      setCallerSecretKey(OWNER_SK);
      expect(runCircuit(contract.circuits.paused)).toBe(false);

      runCircuit(contract.circuits.pause, ownerAccount);
      expect(runCircuit(contract.circuits.paused)).toBe(true);

      runCircuit(contract.circuits.unpause, ownerAccount);
      expect(runCircuit(contract.circuits.paused)).toBe(false);
    });

    it('fails when pausing while already paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      expect(() => {
        runCircuit(contract.circuits.pause, ownerAccount);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('fails when unpausing while not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, ownerAccount);
      }).toThrow('FungibleToken: contract is not paused');
    });

    it('fails when unauthorized user attempts to pause or unpause', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.pause, unauthorizedAccount);
      }).toThrow('FungibleToken: only pauser or owner can call this');

      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, unauthorizedAccount);
      }).toThrow('FungibleToken: only pauser or owner can call this');
    });

    it('blocks transfer, approve, transferFrom, mint, and burn when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      // Attempt transfer
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 100n);
      }).toThrow('FungibleToken: contract is paused');

      // Attempt approve
      expect(() => {
        runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 100n);
      }).toThrow('FungibleToken: contract is paused');

      // Attempt transferFrom
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 100n);
      }).toThrow('FungibleToken: contract is paused');

      // Attempt mint
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, aliceAccount, 100n);
      }).toThrow('FungibleToken: contract is paused');

      // Attempt burn
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, aliceAccount, 100n);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('restores operations after unpausing', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);
      runCircuit(contract.circuits.unpause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 100n);
      expect(success).toBe(true);
      expect(runCircuit(contract.circuits.balanceOf, bobAccount)).toBe(100n);
    });
  });

  describe('Emergency Pauser Role Management', () => {
    it('allows owner to designate a distinct emergency pauser', () => {
      setCallerSecretKey(OWNER_SK);
      const success = runCircuit(contract.circuits.setEmergencyPauser, ownerAccount, pauserAccount);
      expect(success).toBe(true);

      // New emergency pauser can pause contract
      setCallerSecretKey(PAUSER_SK);
      runCircuit(contract.circuits.pause, pauserAccount);
      expect(runCircuit(contract.circuits.paused)).toBe(true);

      // Pauser can also unpause
      runCircuit(contract.circuits.unpause, pauserAccount);
      expect(runCircuit(contract.circuits.paused)).toBe(false);
    });

    it('fails when non-owner attempts to set emergency pauser', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.setEmergencyPauser, aliceAccount, pauserAccount);
      }).toThrow('FungibleToken: only owner can call this');
    });

    it('fails when owner attempts to set zero address as emergency pauser', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.setEmergencyPauser, ownerAccount, zeroKey());
      }).toThrow('FungibleToken: invalid pauser address');
    });
  });

  describe('Emergency Withdrawal', () => {
    it('fails emergency withdrawal when contract is not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, ownerAccount, { bytes: dummyAddressBytes }, 100n);
      }).toThrow('FungibleToken: contract is not paused');
    });

    it('fails emergency withdrawal when called by non-owner even if paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, aliceAccount, { bytes: dummyAddressBytes }, 100n);
      }).toThrow('FungibleToken: only owner can call this');
    });
  });
});