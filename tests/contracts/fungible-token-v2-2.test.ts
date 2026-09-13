import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-2/contract/index.js';

// ============================================================================
// Types & Constants
// ============================================================================

type PrivateState = {
  readonly currentSecretKey: Uint8Array;
};

const MAX_UINT128 = 340282366920938463463374607431768211455n;
const TOKEN_NAME = 'Midnight Fungible Token';
const TOKEN_SYMBOL = 'MFT';
const TOKEN_DECIMALS = 8n;
const DEFAULT_MAX_SUPPLY = 1_000_000_000n;

const dummyContractAddress = '00'.repeat(32);
const dummyCoinPublicKey = '01'.repeat(32);

const createKey = (byteValue: number): Uint8Array => new Uint8Array(32).fill(byteValue);
const pad32 = (str: string): Uint8Array => {
  const buf = new Uint8Array(32);
  const enc = new TextEncoder().encode(str);
  buf.set(enc.subarray(0, 32));
  return buf;
};

const domainTagAuth = pad32('fungible-token:auth');
const CONTRACT_SALT = createKey(99);
const ZERO_KEY = new Uint8Array(32).fill(0);

const OWNER_SK = createKey(1);
const ALICE_SK = createKey(2);
const BOB_SK = createKey(3);
const PAUSER_SK = createKey(4);
const UNAUTHORIZED_SK = createKey(5);

// ============================================================================
// Dynamic Persistent Hash Resolution for Account Derivation
// ============================================================================

const dummySalt = new Uint8Array(32).fill(7);
const helperContract = new Contract({
  localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
});
const proto = Object.getPrototypeOf(helperContract);
const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
let accountHashMethod = '_persistentHash_1';
let passWrappedObject = false;

for (const method of hashMethods) {
  try {
    const t1 = (helperContract as any)[method]([domainTagAuth, dummySalt, createKey(1)]);
    const t2 = (helperContract as any)[method]([domainTagAuth, dummySalt, createKey(2)]);
    if (t1 instanceof Uint8Array && t2 instanceof Uint8Array && Buffer.from(t1).compare(Buffer.from(t2)) !== 0) {
      accountHashMethod = method;
      passWrappedObject = false;
      break;
    }
  } catch {}
  try {
    const t1 = (helperContract as any)[method]([domainTagAuth, { bytes: dummySalt }, createKey(1)]);
    const t2 = (helperContract as any)[method]([domainTagAuth, { bytes: dummySalt }, createKey(2)]);
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

const OWNER_ACCOUNT = deriveAccount(OWNER_SK);
const ALICE_ACCOUNT = deriveAccount(ALICE_SK);
const BOB_ACCOUNT = deriveAccount(BOB_SK);
const PAUSER_ACCOUNT = deriveAccount(PAUSER_SK);
const UNAUTHORIZED_ACCOUNT = deriveAccount(UNAUTHORIZED_SK);

// ============================================================================
// Test Suite
// ============================================================================

describe('fungible-token-v2-2 Contract Test Suite', () => {
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

  const initContract = (
    salt: Uint8Array = CONTRACT_SALT,
    initialOwner: Uint8Array = OWNER_ACCOUNT,
    name: string = TOKEN_NAME,
    symbol: string = TOKEN_SYMBOL,
    decimals: bigint = TOKEN_DECIMALS,
    maxSupply: bigint = DEFAULT_MAX_SUPPLY,
  ) => {
    contract = new Contract(witnesses);
    setCallerSecretKey(OWNER_SK);

    const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
    const { currentContractState } = contract.initialState(
      constructorCtx,
      salt,
      initialOwner,
      name,
      symbol,
      decimals,
      maxSupply,
    );

    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      currentContractState.data,
      privateState,
    );
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
      privateState,
    );
    return result.result;
  };

  const getLedger = () => ledger(circuitContext.currentQueryContext.state);

  const getBalance = (account: Uint8Array): bigint => {
    const l = getLedger();
    return l._balances.member(account) ? l._balances.lookup(account) : 0n;
  };

  const getAllowance = (owner: Uint8Array, spender: Uint8Array): bigint => {
    const l = getLedger();
    const key: [Uint8Array, Uint8Array] = [owner, spender];
    return l._allowances.member(key) ? l._allowances.lookup(key) : 0n;
  };

  beforeEach(() => {
    initContract();
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Contract Initialization', () => {
    it('should initialize contract state correctly with custom parameters', () => {
      const state = getLedger();
      expect(state._name).toBe(TOKEN_NAME);
      expect(state._symbol).toBe(TOKEN_SYMBOL);
      expect(state._decimals).toBe(TOKEN_DECIMALS);
      expect(state._maxSupply).toBe(DEFAULT_MAX_SUPPLY);
      expect(state._totalSupply).toBe(0n);
      expect(state._paused).toBe(false);
      expect(state.owner).toEqual(OWNER_ACCOUNT);
      expect(state._emergencyPauser).toEqual(OWNER_ACCOUNT);
      expect(state._contractSalt).toEqual(CONTRACT_SALT);
    });

    it('should fallback maxSupply to MAX_UINT128 when initialized with 0', () => {
      initContract(CONTRACT_SALT, OWNER_ACCOUNT, TOKEN_NAME, TOKEN_SYMBOL, 18n, 0n);
      const state = getLedger();
      expect(state._maxSupply).toBe(MAX_UINT128);
      expect(state._decimals).toBe(18n);
    });
  });

  // ==========================================================================
  // Minting Tests
  // ==========================================================================

  describe('mint', () => {
    it('should allow owner to mint tokens to an account', () => {
      setCallerSecretKey(OWNER_SK);
      const mintAmount = 500_000n;
      const success = runCircuit(contract.circuits.mint, ALICE_ACCOUNT, mintAmount);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(mintAmount);
      expect(getLedger()._totalSupply).toBe(mintAmount);
    });

    it('should fail when a non-owner tries to mint', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail when minting to zero address', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, ZERO_KEY, 1000n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail when mint amount exceeds max supply', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, ALICE_ACCOUNT, DEFAULT_MAX_SUPPLY + 1n);
      }).toThrow('FungibleToken: supply overflow');
    });

    it('should fail when attempting to mint while contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      expect(getLedger()._paused).toBe(true);

      expect(() => {
        runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 1000n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // Transfer Tests
  // ==========================================================================

  describe('transfer', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 10_000n);
    });

    it('should transfer tokens between accounts when caller is authorized', () => {
      setCallerSecretKey(ALICE_SK);
      const transferAmount = 3_000n;
      const success = runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, transferAmount);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(7_000n);
      expect(getBalance(BOB_ACCOUNT)).toBe(3_000n);
      expect(getLedger()._totalSupply).toBe(10_000n);
    });

    it('should allow self-transfer when balance is sufficient without altering balances', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ALICE_ACCOUNT, 5_000n);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(10_000n);
    });

    it('should fail self-transfer when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ALICE_ACCOUNT, 15_000n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail transfer when caller authorization fails', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 1_000n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail when transfer amount exceeds available balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 15_000n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail transfer to zero address', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ZERO_KEY, 1_000n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail transfer when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 1_000n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // Approvals & TransferFrom Tests
  // ==========================================================================

  describe('approve & transferFrom', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 20_000n);
    });

    it('should approve allowance and allow spender to execute transferFrom', () => {
      setCallerSecretKey(ALICE_SK);
      const approveAmount = 8_000n;
      const approveSuccess = runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, approveAmount);

      expect(approveSuccess).toBe(true);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(approveAmount);

      setCallerSecretKey(BOB_SK);
      const transferAmount = 5_000n;
      const transferSuccess = runCircuit(
        contract.circuits.transferFrom,
        BOB_ACCOUNT,
        ALICE_ACCOUNT,
        BOB_ACCOUNT,
        transferAmount,
      );

      expect(transferSuccess).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(15_000n);
      expect(getBalance(BOB_ACCOUNT)).toBe(5_000n);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(3_000n);
    });

    it('should fail approve when caller authorization fails', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 1000n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail approve to zero address spender', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE_ACCOUNT, ZERO_KEY, 1000n);
      }).toThrow('FungibleToken: invalid spender');
    });

    it('should fail transferFrom when allowance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 2_000n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB_ACCOUNT, ALICE_ACCOUNT, BOB_ACCOUNT, 2_001n);
      }).toThrow('FungibleToken: insufficient allowance');
    });

    it('should fail transferFrom when contract is paused', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 5_000n);

      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB_ACCOUNT, ALICE_ACCOUNT, BOB_ACCOUNT, 1_000n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // Burning Tests
  // ==========================================================================

  describe('burn', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, ALICE_ACCOUNT, 10_000n);
    });

    it('should allow token holder to burn their own tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const burnAmount = 4_000n;
      const success = runCircuit(contract.circuits.burn, ALICE_ACCOUNT, burnAmount);

      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(6_000n);
      expect(getLedger()._totalSupply).toBe(6_000n);
    });

    it('should fail burn when amount exceeds holder balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, ALICE_ACCOUNT, 10_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail burn when caller authorization fails', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, ALICE_ACCOUNT, 1_000n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail burn when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, ALICE_ACCOUNT, 1_000n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // Emergency Stop & Pauser Tests
  // ==========================================================================

  describe('Emergency Stop (pause / unpause / setEmergencyPauser)', () => {
    it('should allow owner to pause and unpause the contract', () => {
      setCallerSecretKey(OWNER_SK);

      const pauseSuccess = runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      expect(pauseSuccess).toBe(true);
      expect(getLedger()._paused).toBe(true);

      const unpauseSuccess = runCircuit(contract.circuits.unpause, OWNER_ACCOUNT);
      expect(unpauseSuccess).toBe(true);
      expect(getLedger()._paused).toBe(false);
    });

    it('should fail when pausing an already paused contract', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      expect(() => {
        runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should fail when unpausing a contract that is not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, OWNER_ACCOUNT);
      }).toThrow('FungibleToken: contract is not paused');
    });

    it('should allow owner to configure emergency pauser role and allow pauser to toggle pause', () => {
      setCallerSecretKey(OWNER_SK);
      const setPauserSuccess = runCircuit(contract.circuits.setEmergencyPauser, OWNER_ACCOUNT, PAUSER_ACCOUNT);
      expect(setPauserSuccess).toBe(true);
      expect(getLedger()._emergencyPauser).toEqual(PAUSER_ACCOUNT);

      setCallerSecretKey(PAUSER_SK);
      const pauseSuccess = runCircuit(contract.circuits.pause, PAUSER_ACCOUNT);
      expect(pauseSuccess).toBe(true);
      expect(getLedger()._paused).toBe(true);

      const unpauseSuccess = runCircuit(contract.circuits.unpause, PAUSER_ACCOUNT);
      expect(unpauseSuccess).toBe(true);
      expect(getLedger()._paused).toBe(false);
    });

    it('should reject setting zero address as emergency pauser', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.setEmergencyPauser, OWNER_ACCOUNT, ZERO_KEY);
      }).toThrow('FungibleToken: invalid pauser address');
    });

    it('should reject unauthorized callers from setting emergency pauser', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.setEmergencyPauser, UNAUTHORIZED_ACCOUNT, PAUSER_ACCOUNT);
      }).toThrow('FungibleToken: only owner can call this');
    });

    it('should reject unauthorized callers from pausing or unpausing', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.pause, UNAUTHORIZED_ACCOUNT);
      }).toThrow('FungibleToken: only pauser or owner can call this');

      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, UNAUTHORIZED_ACCOUNT);
      }).toThrow('FungibleToken: only pauser or owner can call this');
    });
  });

  // ==========================================================================
  // Emergency Withdrawal Tests
  // ==========================================================================

  describe('emergencyWithdraw', () => {
    const dummyContractToken = { bytes: createKey(42) };

    it('should fail emergency withdrawal when contract is not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, OWNER_ACCOUNT, dummyContractToken, 1000n);
      }).toThrow('FungibleToken: contract is not paused');
    });

    it('should fail emergency withdrawal when called by non-owner', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, ALICE_ACCOUNT, dummyContractToken, 1000n);
      }).toThrow('FungibleToken: only owner can call this');
    });

    it('should fail emergency withdrawal when contract balance is insufficient', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, OWNER_ACCOUNT, dummyContractToken, 500n);
      }).toThrow('FungibleToken: insufficient balance');
    });
  });
});