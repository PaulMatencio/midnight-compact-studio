import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-3/contract/index.js';

// ============ Helper Utilities ============

const createKey = (b: number): Uint8Array => new Uint8Array(32).fill(b);
const ZERO_KEY = new Uint8Array(32).fill(0);

const pad = (len: number, str: string): Uint8Array => {
  const buf = new Uint8Array(len);
  const encoded = new TextEncoder().encode(str);
  buf.set(encoded.subarray(0, len));
  return buf;
};

const domainTagAuth = pad(32, 'fungible-token:auth');

const CONTRACT_SALT = createKey(99);
const dummyContractAddress = '00'.repeat(32);
const dummyCoinPublicKey = '01'.repeat(32);

const TOKEN_NAME = 'Midnight Fungible Token';
const TOKEN_SYMBOL = 'MFT';
const DECIMALS = 8n;
const MAX_SUPPLY = 1_000_000n * 10n ** 8n;
const MAX_UINT128 = 340282366920938463463374607431768211455n;

// Setup test keys
const OWNER_SK = createKey(1);
const ALICE_SK = createKey(2);
const BOB_SK = createKey(3);
const PAUSER_SK = createKey(4);
const UNAUTHORIZED_SK = createKey(5);

// Dynamic persistent hash discovery for account derivation
const helperContract = new Contract({ localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)] });
const proto = Object.getPrototypeOf(helperContract);
const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
let accountHashMethod = '_persistentHash_1';
let passWrappedObject = false;

for (const method of hashMethods) {
  try {
    const t1 = (helperContract as any)[method]([domainTagAuth, CONTRACT_SALT, createKey(1)]);
    const t2 = (helperContract as any)[method]([domainTagAuth, CONTRACT_SALT, createKey(2)]);
    if (t1 instanceof Uint8Array && t2 instanceof Uint8Array && Buffer.from(t1).compare(Buffer.from(t2)) !== 0) {
      accountHashMethod = method;
      passWrappedObject = false;
      break;
    }
  } catch {}
  try {
    const t1 = (helperContract as any)[method]([domainTagAuth, { bytes: CONTRACT_SALT }, createKey(1)]);
    const t2 = (helperContract as any)[method]([domainTagAuth, { bytes: CONTRACT_SALT }, createKey(2)]);
    if (t1 instanceof Uint8Array && t2 instanceof Uint8Array && Buffer.from(t1).compare(Buffer.from(t2)) !== 0) {
      accountHashMethod = method;
      passWrappedObject = true;
      break;
    }
  } catch {}
}

const deriveAccount = (sk: Uint8Array, salt: Uint8Array = CONTRACT_SALT): Uint8Array => {
  const saltArg = passWrappedObject ? { bytes: salt } : salt;
  return (helperContract as any)[accountHashMethod]([domainTagAuth, saltArg, sk]);
};

// Derived public accounts
const OWNER_ACCOUNT = deriveAccount(OWNER_SK);
const ALICE_ACCOUNT = deriveAccount(ALICE_SK);
const BOB_ACCOUNT = deriveAccount(BOB_SK);
const PAUSER_ACCOUNT = deriveAccount(PAUSER_SK);
const UNAUTHORIZED_ACCOUNT = deriveAccount(UNAUTHORIZED_SK);

type PrivateState = {
  readonly currentSecretKey: Uint8Array;
};

describe('FungibleToken v2.3 Contract Test Suite', () => {
  let contract: Contract<PrivateState>;
  let circuitContext: any;
  let currentCallerSecretKey: Uint8Array;
  let privateState: PrivateState;

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

  const getBalance = (account: Uint8Array): bigint => {
    const l = getLedger();
    return l._balances.member(account) ? l._balances.lookup(account) : 0n;
  };

  const getAllowance = (ownerAcc: Uint8Array, spender: Uint8Array): bigint => {
    const l = getLedger();
    const key: [Uint8Array, Uint8Array] = [ownerAcc, spender];
    return l._allowances.member(key) ? l._allowances.lookup(key) : 0n;
  };

  const deployFreshContract = (
    salt: Uint8Array = CONTRACT_SALT,
    ownerAcc: Uint8Array = OWNER_ACCOUNT,
    name: string = TOKEN_NAME,
    symbol: string = TOKEN_SYMBOL,
    decimals: bigint = DECIMALS,
    maxSupply: bigint = MAX_SUPPLY
  ) => {
    contract = new Contract(witnesses);
    currentCallerSecretKey = OWNER_SK;
    privateState = { currentSecretKey: OWNER_SK };

    const constructorCtx = CompactRuntime.createConstructorContext(
      privateState,
      dummyCoinPublicKey
    );

    const { currentContractState } = contract.initialState(
      constructorCtx,
      salt,
      ownerAcc,
      name,
      symbol,
      decimals,
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
    deployFreshContract();
  });

  describe('Constructor & Initial State', () => {
    it('initializes public ledger state accurately', () => {
      const l = getLedger();
      expect(l._name).toBe(TOKEN_NAME);
      expect(l._symbol).toBe(TOKEN_SYMBOL);
      expect(l._decimals).toBe(DECIMALS);
      expect(l._totalSupply).toBe(0n);
      expect(l._maxSupply).toBe(MAX_SUPPLY);
      expect(l.owner).toEqual(OWNER_ACCOUNT);
      expect(l._contractSalt).toEqual(CONTRACT_SALT);
      expect(l._paused).toBe(false);
      expect(l._emergencyPauser).toEqual(OWNER_ACCOUNT);
    });

    it('sets _maxSupply to MAX_UINT128 when maxSupply_ is 0', () => {
      deployFreshContract(CONTRACT_SALT, OWNER_ACCOUNT, TOKEN_NAME, TOKEN_SYMBOL, DECIMALS, 0n);
      const l = getLedger();
      expect(l._maxSupply).toBe(MAX_UINT128);
    });
  });

  describe('Authentication & Caller Authorization', () => {
    it('fails when caller provides an account that does not match their secret key', () => {
      setCallerSecretKey(ALICE_SK);
      // Alice tries to act as Bob
      expect(() =>
        runCircuit(contract.circuits.transfer, BOB_ACCOUNT, ALICE_ACCOUNT, 100n)
      ).toThrow('FungibleToken: caller authorization failed');
    });

    it('fails when using an incorrect contract salt for key derivation', () => {
      const wrongSalt = createKey(42);
      const wrongSaltAccount = deriveAccount(ALICE_SK, wrongSalt);
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.transfer, wrongSaltAccount, BOB_ACCOUNT, 100n)
      ).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('Minting', () => {
    it('allows contract owner to mint tokens to an account', () => {
      setCallerSecretKey(OWNER_SK);
      const mintAmount = 5000n;
      const success = runCircuit(contract.circuits.mint, ALICE_ACCOUNT, mintAmount);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(mintAmount);
      expect(getLedger()._totalSupply).toBe(mintAmount);
    });

    it('rejects minting from unauthorized caller', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n)
      ).toThrow('FungibleToken: caller authorization failed');
    });

    it('rejects minting to zero address', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.mint, ZERO_KEY, 1000n)
      ).toThrow('FungibleToken: invalid receiver');
    });

    it('rejects minting beyond maximum supply', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.mint, ALICE_ACCOUNT, MAX_SUPPLY + 1n)
      ).toThrow('FungibleToken: supply overflow');
    });
  });

  describe('Transfers', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n);
    });

    it('allows a token holder to transfer tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 400n);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(600n);
      expect(getBalance(BOB_ACCOUNT)).toBe(400n);
      expect(getLedger()._totalSupply).toBe(1000n);
    });

    it('allows self-transfer if balance is sufficient without mutating balance', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ALICE_ACCOUNT, 300n);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(1000n);
    });

    it('rejects self-transfer if balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ALICE_ACCOUNT, 1500n)
      ).toThrow('FungibleToken: insufficient balance');
    });

    it('rejects transfer with insufficient balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 1001n)
      ).toThrow('FungibleToken: insufficient balance');
    });

    it('rejects transfer to zero address', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ZERO_KEY, 100n)
      ).toThrow('FungibleToken: invalid receiver');
    });
  });

  describe('Approvals & TransferFrom', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n);
    });

    it('allows owner to approve a spender', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 500n);

      expect(success).toBe(true);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(500n);
    });

    it('rejects approval with zero spender', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.approve, ALICE_ACCOUNT, ZERO_KEY, 500n)
      ).toThrow('FungibleToken: invalid spender');
    });

    it('allows spender to transfer tokens within allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 500n);

      setCallerSecretKey(BOB_SK);
      const success = runCircuit(
        contract.circuits.transferFrom,
        BOB_ACCOUNT,
        ALICE_ACCOUNT,
        BOB_ACCOUNT,
        300n
      );

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(700n);
      expect(getBalance(BOB_ACCOUNT)).toBe(300n);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(200n);
    });

    it('does not reduce allowance if set to MAX_UINT128 (infinite allowance)', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, MAX_UINT128);

      setCallerSecretKey(BOB_SK);
      runCircuit(
        contract.circuits.transferFrom,
        BOB_ACCOUNT,
        ALICE_ACCOUNT,
        BOB_ACCOUNT,
        250n
      );

      expect(getBalance(ALICE_ACCOUNT)).toBe(750n);
      expect(getBalance(BOB_ACCOUNT)).toBe(250n);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(MAX_UINT128);
    });

    it('rejects transferFrom exceeding allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 200n);

      setCallerSecretKey(BOB_SK);
      expect(() =>
        runCircuit(
          contract.circuits.transferFrom,
          BOB_ACCOUNT,
          ALICE_ACCOUNT,
          BOB_ACCOUNT,
          201n
        )
      ).toThrow('FungibleToken: insufficient allowance');
    });
  });

  describe('Burning', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n);
    });

    it('allows token holder to burn their tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.burn, ALICE_ACCOUNT, 400n);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(600n);
      expect(getLedger()._totalSupply).toBe(600n);
    });

    it('rejects burning more tokens than account balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.burn, ALICE_ACCOUNT, 1001n)
      ).toThrow('FungibleToken: insufficient balance');
    });
  });

  describe('Emergency Stop & Pausing Mechanics', () => {
    it('allows owner to pause and unpause the contract', () => {
      setCallerSecretKey(OWNER_SK);

      expect(getLedger()._paused).toBe(false);
      const pauseSuccess = runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      expect(pauseSuccess).toBe(true);
      expect(getLedger()._paused).toBe(true);

      const unpauseSuccess = runCircuit(contract.circuits.unpause, OWNER_ACCOUNT);
      expect(unpauseSuccess).toBe(true);
      expect(getLedger()._paused).toBe(false);
    });

    it('rejects pause when contract is already paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      expect(() =>
        runCircuit(contract.circuits.pause, OWNER_ACCOUNT)
      ).toThrow('FungibleToken: contract is paused');
    });

    it('rejects unpause when contract is not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.unpause, OWNER_ACCOUNT)
      ).toThrow('FungibleToken: contract is not paused');
    });

    it('allows designated emergency pauser to pause and unpause', () => {
      // 1. Owner sets Pauser
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.setEmergencyPauser, OWNER_ACCOUNT, PAUSER_ACCOUNT);
      expect(getLedger()._emergencyPauser).toEqual(PAUSER_ACCOUNT);

      // 2. Pauser pauses
      setCallerSecretKey(PAUSER_SK);
      runCircuit(contract.circuits.pause, PAUSER_ACCOUNT);
      expect(getLedger()._paused).toBe(true);

      // 3. Pauser unpauses
      runCircuit(contract.circuits.unpause, PAUSER_ACCOUNT);
      expect(getLedger()._paused).toBe(false);
    });

    it('rejects unauthorized caller trying to pause or unpause', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() =>
        runCircuit(contract.circuits.pause, UNAUTHORIZED_ACCOUNT)
      ).toThrow('FungibleToken: only pauser or owner can call this');
    });

    it('rejects setting invalid zero key as emergency pauser', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.setEmergencyPauser, OWNER_ACCOUNT, ZERO_KEY)
      ).toThrow('FungibleToken: invalid pauser address');
    });

    it('rejects non-owner setting emergency pauser', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.setEmergencyPauser, ALICE_ACCOUNT, PAUSER_ACCOUNT)
      ).toThrow('FungibleToken: only owner can call this');
    });

    describe('when paused', () => {
      beforeEach(() => {
        setCallerSecretKey(OWNER_SK);
        runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n);
        runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      });

      it('blocks transfer', () => {
        setCallerSecretKey(ALICE_SK);
        expect(() =>
          runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 100n)
        ).toThrow('FungibleToken: contract is paused');
      });

      it('blocks approve', () => {
        setCallerSecretKey(ALICE_SK);
        expect(() =>
          runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 100n)
        ).toThrow('FungibleToken: contract is paused');
      });

      it('blocks transferFrom', () => {
        setCallerSecretKey(BOB_SK);
        expect(() =>
          runCircuit(contract.circuits.transferFrom, BOB_ACCOUNT, ALICE_ACCOUNT, BOB_ACCOUNT, 100n)
        ).toThrow('FungibleToken: contract is paused');
      });

      it('blocks mint', () => {
        setCallerSecretKey(OWNER_SK);
        expect(() =>
          runCircuit(contract.circuits.mint, BOB_ACCOUNT, 100n)
        ).toThrow('FungibleToken: contract is paused');
      });

      it('blocks burn', () => {
        setCallerSecretKey(ALICE_SK);
        expect(() =>
          runCircuit(contract.circuits.burn, ALICE_ACCOUNT, 100n)
        ).toThrow('FungibleToken: contract is paused');
      });
    });
  });

  describe('Admin Reallocate & Emergency Withdraw', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n);
    });

    it('allows owner to reallocate tokens from trapped account to target account', () => {
      setCallerSecretKey(OWNER_SK);
      const success = runCircuit(
        contract.circuits.adminReallocate,
        OWNER_ACCOUNT,
        ALICE_ACCOUNT,
        BOB_ACCOUNT,
        400n
      );

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(600n);
      expect(getBalance(BOB_ACCOUNT)).toBe(400n);
    });

    it('rejects adminReallocate from non-owner', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(
          contract.circuits.adminReallocate,
          ALICE_ACCOUNT,
          ALICE_ACCOUNT,
          BOB_ACCOUNT,
          100n
        )
      ).toThrow('FungibleToken: only owner can call this');
    });

    it('rejects emergencyWithdraw when contract is not paused', () => {
      setCallerSecretKey(OWNER_SK);
      const dummyTokenAddress = { bytes: createKey(88) };
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, OWNER_ACCOUNT, dummyTokenAddress, 100n)
      ).toThrow('FungibleToken: contract is not paused');
    });

    it('rejects emergencyWithdraw when called by non-owner', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      const dummyTokenAddress = { bytes: createKey(88) };
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, ALICE_ACCOUNT, dummyTokenAddress, 100n)
      ).toThrow('FungibleToken: only owner can call this');
    });
  });
});