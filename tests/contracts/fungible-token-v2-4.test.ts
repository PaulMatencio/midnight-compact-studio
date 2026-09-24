import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

// ============ Deterministic Mock Utilities & Constants ============

const createKey = (byteValue: number): Uint8Array => new Uint8Array(32).fill(byteValue);
const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);

const pad = (length: number, str: string): Uint8Array => {
  const bytes = new TextEncoder().encode(str);
  const result = new Uint8Array(length);
  result.set(bytes.subarray(0, length));
  return result;
};

const domainTagAuth = pad(32, 'fungible-token:auth');

const dummyContractAddress = '00'.repeat(32);
const dummyCoinPublicKey = '01'.repeat(32);

const CONTRACT_SALT = createKey(99);
const TOKEN_NAME = 'Midnight Fungible Token';
const TOKEN_SYMBOL = 'MFT';
const DECIMALS = 18n;
const MAX_SUPPLY = 1_000_000_000n * 10n ** 18n;
const THRESHOLD = 2n;

const INITIAL_SIGNERS: [Uint8Array, Uint8Array, Uint8Array] = [
  createKey(11),
  createKey(12),
  createKey(13),
];

// Caller Secret Keys
const OWNER_SK = createKey(1);
const ALICE_SK = createKey(2);
const BOB_SK = createKey(3);
const CHARLIE_SK = createKey(4);
const UNAUTHORIZED_SK = createKey(5);

// Struct definitions matching Compact
interface JubjubPoint {
  x: bigint;
  y: bigint;
}

interface SchnorrSignature {
  announcement: JubjubPoint;
  response: bigint;
}

interface PrivateState {
  currentSecretKey: Uint8Array;
}

// Dummy Jubjub points & signatures for testing multi-sig guard rails
const dummyPoint1: JubjubPoint = { x: 0n, y: 1n };
const dummyPoint2: JubjubPoint = { x: 0n, y: 2n };
const dummySig: SchnorrSignature = { announcement: { x: 0n, y: 1n }, response: 0n };

// ============ Dynamic Persistent Hash Discovery ============

let accountHashMethod = '_persistentHash_1';
let passWrappedObject = false;

{
  const dummySalt = new Uint8Array(32).fill(7);
  const helperContract = new Contract({
    localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
    getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
  });
  const proto = Object.getPrototypeOf(helperContract);
  const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));

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
}

const deriveAccount = (sk: Uint8Array, salt: Uint8Array = CONTRACT_SALT): Uint8Array => {
  const dummySalt = salt;
  const helperContract = new Contract({
    localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
    getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
  });
  const saltArg = passWrappedObject ? { bytes: dummySalt } : dummySalt;
  return (helperContract as any)[accountHashMethod]([domainTagAuth, saltArg, sk]);
};

// ============ Vitest Test Suite ============

describe('FungibleToken Contract v2.4 (Vitest Unit Tests)', () => {
  let contract: Contract<PrivateState>;
  let circuitContext: any;
  let currentCallerSecretKey: Uint8Array;
  let privateState: PrivateState;

  // Derived caller accounts
  let OWNER_ACCOUNT: Uint8Array;
  let ALICE_ACCOUNT: Uint8Array;
  let BOB_ACCOUNT: Uint8Array;
  let CHARLIE_ACCOUNT: Uint8Array;
  let UNAUTHORIZED_ACCOUNT: Uint8Array;

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
    getSchnorrReduction: (ctx, challengeHash: bigint) => {
      const TWO_248 = 1n << 248n;
      return [ctx.privateState, [challengeHash / TWO_248, challengeHash % TWO_248]];
    },
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

  const getAllowance = (tokenOwner: Uint8Array, spender: Uint8Array): bigint => {
    const l = getLedger();
    const key: [Uint8Array, Uint8Array] = [tokenOwner, spender];
    return l._allowances.member(key) ? l._allowances.lookup(key) : 0n;
  };

  beforeEach(() => {
    // Derive caller public identities using the contract salt
    OWNER_ACCOUNT = deriveAccount(OWNER_SK);
    ALICE_ACCOUNT = deriveAccount(ALICE_SK);
    BOB_ACCOUNT = deriveAccount(BOB_SK);
    CHARLIE_ACCOUNT = deriveAccount(CHARLIE_SK);
    UNAUTHORIZED_ACCOUNT = deriveAccount(UNAUTHORIZED_SK);

    // Default caller is the owner
    currentCallerSecretKey = OWNER_SK;
    privateState = { currentSecretKey: OWNER_SK };

    contract = new Contract(witnesses);

    const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
    const { currentContractState } = contract.initialState(
      constructorCtx,
      CONTRACT_SALT,
      OWNER_ACCOUNT,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      DECIMALS,
      MAX_SUPPLY,
      INITIAL_SIGNERS,
      THRESHOLD
    );

    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      currentContractState.data,
      privateState
    );
  });

  // ==========================================================================
  // 1. Constructor & Initial State Verification
  // ==========================================================================
  describe('Constructor & Initial State', () => {
    it('should initialize token metadata and configuration correctly', () => {
      const state = getLedger();
      expect(state._name).toBe(TOKEN_NAME);
      expect(state._symbol).toBe(TOKEN_SYMBOL);
      expect(state._decimals).toBe(18n);
      expect(state._totalSupply).toBe(0n);
      expect(state._maxSupply).toBe(MAX_SUPPLY);
      expect(state.owner).toEqual(OWNER_ACCOUNT);
      expect(state._contractSalt).toEqual(CONTRACT_SALT);
      expect(state._paused).toBe(false);
      expect(state._emergencyPauser).toEqual(OWNER_ACCOUNT);
      expect(state._multisigThreshold).toBe(2n);
      expect(state._multisigSignerCount).toBe(3n);
      expect(state._multisigNonce).toBe(0n);

      for (const signer of INITIAL_SIGNERS) {
        expect(state._multisigSigners.member(signer)).toBe(true);
      }
    });

    it('should reject threshold less than 1', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() => {
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          OWNER_ACCOUNT,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          DECIMALS,
          MAX_SUPPLY,
          INITIAL_SIGNERS,
          0n
        );
      }).toThrow('FungibleToken: invalid threshold');
    });

    it('should reject threshold greater than 3', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() => {
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          OWNER_ACCOUNT,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          DECIMALS,
          MAX_SUPPLY,
          INITIAL_SIGNERS,
          4n
        );
      }).toThrow('FungibleToken: invalid threshold');
    });

    it('should reject duplicate initial signers in constructor', () => {
      const duplicateSigners: [Uint8Array, Uint8Array, Uint8Array] = [
        createKey(11),
        createKey(11),
        createKey(13),
      ];
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() => {
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          OWNER_ACCOUNT,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          DECIMALS,
          MAX_SUPPLY,
          duplicateSigners,
          THRESHOLD
        );
      }).toThrow('FungibleToken: duplicate initial signer');
    });
  });

  // ==========================================================================
  // 2. Authentication & Caller Synchronization
  // ==========================================================================
  describe('Authentication & Caller Isolation', () => {
    it('should reject caller whose secret key does not match the passed identity', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, BOB_ACCOUNT, CHARLIE_ACCOUNT, 0n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should authorize caller when secret key matches the identity', () => {
      setCallerSecretKey(ALICE_SK);
      const res = runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 0n);
      expect(res).toBe(true);
    });

    it('should synchronize properly across sequential callers without cross-caller leakage', () => {
      // Alice calls transfer
      setCallerSecretKey(ALICE_SK);
      expect(runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 0n)).toBe(true);

      // Bob calls transfer
      setCallerSecretKey(BOB_SK);
      expect(runCircuit(contract.circuits.transfer, BOB_ACCOUNT, CHARLIE_ACCOUNT, 0n)).toBe(true);

      // Charlie calls transfer
      setCallerSecretKey(CHARLIE_SK);
      expect(runCircuit(contract.circuits.transfer, CHARLIE_ACCOUNT, OWNER_ACCOUNT, 0n)).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Pause & Emergency Stop Controls
  // ==========================================================================
  describe('Emergency Stop (pause / unpause)', () => {
    it('should allow owner to pause the contract', () => {
      setCallerSecretKey(OWNER_SK);
      const success = runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      expect(success).toBe(true);
      expect(getLedger()._paused).toBe(true);
    });

    it('should reject pause call from unauthorized user', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.pause, ALICE_ACCOUNT);
      }).toThrow('FungibleToken: only pauser or owner can call this');
      expect(getLedger()._paused).toBe(false);
    });

    it('should reject pause call when contract is already paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      expect(getLedger()._paused).toBe(true);

      expect(() => {
        runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should allow owner to unpause a paused contract', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);
      expect(getLedger()._paused).toBe(true);

      const success = runCircuit(contract.circuits.unpause, OWNER_ACCOUNT);
      expect(success).toBe(true);
      expect(getLedger()._paused).toBe(false);
    });

    it('should reject unpause call when contract is not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, OWNER_ACCOUNT);
      }).toThrow('FungibleToken: contract is not paused');
    });

    it('should reject unpause call from unauthorized user', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, ALICE_ACCOUNT);
      }).toThrow('FungibleToken: only pauser or owner can call this');
    });
  });

  // ==========================================================================
  // 4. Standard Token Operations: Allowances & Approvals
  // ==========================================================================
  describe('Approvals & Allowances', () => {
    it('should record allowance when owner approves spender', () => {
      setCallerSecretKey(ALICE_SK);
      const approvalAmount = 500n;
      const success = runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, approvalAmount);
      expect(success).toBe(true);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(approvalAmount);
    });

    it('should allow updating existing allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 500n);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(500n);

      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 1_200n);
      expect(getAllowance(ALICE_ACCOUNT, BOB_ACCOUNT)).toBe(1_200n);
    });

    it('should reject approving the zero key as spender', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE_ACCOUNT, zeroKey(), 100n);
      }).toThrow('FungibleToken: invalid spender');
    });

    it('should return 0 for uninitialized allowance query', () => {
      expect(getAllowance(ALICE_ACCOUNT, CHARLIE_ACCOUNT)).toBe(0n);
    });

    it('should reject approve circuit when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 100n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // 5. Standard Token Operations: Transfers & Balances
  // ==========================================================================
  describe('Transfers', () => {
    it('should allow transfer of 0 tokens even with 0 balance', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 0n);
      expect(success).toBe(true);
      expect(getBalance(ALICE_ACCOUNT)).toBe(0n);
      expect(getBalance(BOB_ACCOUNT)).toBe(0n);
    });

    it('should reject transfer when sender has insufficient balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 100n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should reject transfer to zero key recipient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, zeroKey(), 0n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should allow self-transfer of 0 amount', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ALICE_ACCOUNT, 0n);
      expect(success).toBe(true);
    });

    it('should reject self-transfer when amount exceeds balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, ALICE_ACCOUNT, 50n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should reject transfer when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE_ACCOUNT, BOB_ACCOUNT, 0n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // 6. TransferFrom Lifecycle
  // ==========================================================================
  describe('transferFrom', () => {
    it('should allow transferFrom of 0 tokens when allowance exists', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 100n);

      setCallerSecretKey(BOB_SK);
      const success = runCircuit(
        contract.circuits.transferFrom,
        BOB_ACCOUNT,
        ALICE_ACCOUNT,
        CHARLIE_ACCOUNT,
        0n
      );
      expect(success).toBe(true);
    });

    it('should reject transferFrom when allowance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 50n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(
          contract.circuits.transferFrom,
          BOB_ACCOUNT,
          ALICE_ACCOUNT,
          CHARLIE_ACCOUNT,
          100n
        );
      }).toThrow('FungibleToken: insufficient allowance');
    });

    it('should reject transferFrom when contract is paused', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE_ACCOUNT, BOB_ACCOUNT, 100n);

      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(
          contract.circuits.transferFrom,
          BOB_ACCOUNT,
          ALICE_ACCOUNT,
          CHARLIE_ACCOUNT,
          0n
        );
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // 7. Token Self-Burn
  // ==========================================================================
  describe('selfBurn', () => {
    it('should allow self-burning 0 tokens with 0 balance', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.selfBurn, ALICE_ACCOUNT, 0n);
      expect(success).toBe(true);
      expect(getLedger()._totalSupply).toBe(0n);
    });

    it('should reject selfBurn when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.selfBurn, ALICE_ACCOUNT, 100n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should reject selfBurn when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.selfBurn, ALICE_ACCOUNT, 0n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  // ==========================================================================
  // 8. Admin Reallocate
  // ==========================================================================
  describe('adminReallocate', () => {
    it('should allow owner to reallocate 0 balance between accounts', () => {
      setCallerSecretKey(OWNER_SK);
      const success = runCircuit(
        contract.circuits.adminReallocate,
        OWNER_ACCOUNT,
        ALICE_ACCOUNT,
        BOB_ACCOUNT,
        0n
      );
      expect(success).toBe(true);
    });

    it('should reject adminReallocate when called by non-owner', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(
          contract.circuits.adminReallocate,
          ALICE_ACCOUNT,
          BOB_ACCOUNT,
          CHARLIE_ACCOUNT,
          0n
        );
      }).toThrow('FungibleToken: only owner can call this');
    });

    it('should reject adminReallocate with insufficient balance in trapped account', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(
          contract.circuits.adminReallocate,
          OWNER_ACCOUNT,
          ALICE_ACCOUNT,
          BOB_ACCOUNT,
          500n
        );
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should reject adminReallocate when target account is zero key', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(
          contract.circuits.adminReallocate,
          OWNER_ACCOUNT,
          ALICE_ACCOUNT,
          zeroKey(),
          0n
        );
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should reject adminReallocate when trapped account is zero key', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(
          contract.circuits.adminReallocate,
          OWNER_ACCOUNT,
          zeroKey(),
          BOB_ACCOUNT,
          0n
        );
      }).toThrow('FungibleToken: invalid sender');
    });
  });

  // ==========================================================================
  // 9. Emergency Withdrawal
  // ==========================================================================
  describe('emergencyWithdraw', () => {
    const dummyContractToken = { bytes: new Uint8Array(32).fill(2) };

    it('should reject emergencyWithdraw when contract is not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, OWNER_ACCOUNT, dummyContractToken, 0n);
      }).toThrow('FungibleToken: contract is not paused');
    });

    it('should reject emergencyWithdraw when called by non-owner', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, ALICE_ACCOUNT, dummyContractToken, 0n);
      }).toThrow('FungibleToken: only owner can call this');
    });

    it('should reject emergencyWithdraw when contract balance is insufficient', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      expect(() => {
        runCircuit(contract.circuits.emergencyWithdraw, OWNER_ACCOUNT, dummyContractToken, 100n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should succeed for 0 amount emergency withdrawal when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      const success = runCircuit(
        contract.circuits.emergencyWithdraw,
        OWNER_ACCOUNT,
        dummyContractToken,
        0n
      );
      expect(success).toBe(true);
    });
  });

  // ==========================================================================
  // 10. Multi-Sig Governed Operations & Guard Rails
  // ==========================================================================
  describe('Multi-Sig Governed Operations Guard Rails', () => {
    it('should reject mint when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      expect(() => {
        runCircuit(
          contract.circuits.mint,
          ALICE_ACCOUNT,
          100n,
          [dummyPoint1, dummyPoint2],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should reject mint to zero key receiver', () => {
      expect(() => {
        runCircuit(
          contract.circuits.mint,
          zeroKey(),
          100n,
          [dummyPoint1, dummyPoint2],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should reject mint when duplicate signers are detected', () => {
      expect(() => {
        runCircuit(
          contract.circuits.mint,
          ALICE_ACCOUNT,
          100n,
          [dummyPoint1, dummyPoint1],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: duplicate signer detected');
    });

    it('should reject mint when signers are not registered in multisig set', () => {
      expect(() => {
        runCircuit(
          contract.circuits.mint,
          ALICE_ACCOUNT,
          100n,
          [dummyPoint1, dummyPoint2],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: signer not registered');
    });

    it('should reject burn when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER_ACCOUNT);

      expect(() => {
        runCircuit(
          contract.circuits.burn,
          ALICE_ACCOUNT,
          100n,
          [dummyPoint1, dummyPoint2],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should reject burn from zero key sender', () => {
      expect(() => {
        runCircuit(
          contract.circuits.burn,
          zeroKey(),
          100n,
          [dummyPoint1, dummyPoint2],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: invalid sender');
    });

    it('should reject setEmergencyPauser with zero key', () => {
      expect(() => {
        runCircuit(
          contract.circuits.setEmergencyPauser,
          zeroKey(),
          [dummyPoint1, dummyPoint2],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: invalid pauser address');
    });

    it('should reject setEmergencyPauser when signers are not registered', () => {
      expect(() => {
        runCircuit(
          contract.circuits.setEmergencyPauser,
          BOB_ACCOUNT,
          [dummyPoint1, dummyPoint2],
          [dummySig, dummySig]
        );
      }).toThrow('FungibleToken: signer not registered');
    });
  });
});