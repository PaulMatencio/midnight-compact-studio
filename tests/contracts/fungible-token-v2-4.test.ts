import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

// ============ Constant Definitions & Helpers ============

const MAX_UINT128 = 340282366920938463463374607431768211455n;
const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

const createKey = (b: number): Uint8Array => new Uint8Array(32).fill(b);
const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);

const CONTRACT_SALT = createKey(1);
const OWNER_SK = createKey(10);
const ALICE_SK = createKey(20);
const BOB_SK = createKey(30);
const PAUSER_SK = createKey(40);
const UNAUTHORIZED_SK = createKey(99);

const dummyContractAddress = '00'.repeat(32);
const dummyCoinPublicKey = '01'.repeat(32);

const TOKEN_NAME = 'Test Fungible Token';
const TOKEN_SYMBOL = 'TFT';
const TOKEN_DECIMALS = 18n;
const TOKEN_MAX_SUPPLY = 1_000_000n;
const INITIAL_SIGNERS: [Uint8Array, Uint8Array, Uint8Array] = [
  createKey(101),
  createKey(102),
  createKey(103),
];
const THRESHOLD = 2n;

// Dummy Jubjub points for multisig tests
const DUMMY_POINT_A = { x: 1n, y: 2n };
const DUMMY_POINT_B = { x: 3n, y: 4n };
const DUMMY_SIGNATURE = {
  announcement: { x: 1n, y: 2n },
  response: 0n,
};

// Domain tag for deriveAccount: "fungible-token:auth" padded to 32 bytes
const domainTagAuth = new Uint8Array(32);
domainTagAuth.set(new TextEncoder().encode('fungible-token:auth'));

// Dynamic persistent hash discovery to find the exact method for caller identity derivation
const dummySalt = new Uint8Array(32).fill(7);
const helperContract = new Contract({
  localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
  getSchnorrReduction: (ctx: any, challengeHash: bigint) => [ctx.privateState, [0n, 0n]],
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

// Derived caller public identities
const ownerAccount = deriveAccount(OWNER_SK);
const aliceAccount = deriveAccount(ALICE_SK);
const bobAccount = deriveAccount(BOB_SK);
const pauserAccount = deriveAccount(PAUSER_SK);
const unauthorizedAccount = deriveAccount(UNAUTHORIZED_SK);

// ============ Private State & Witnesses ============

interface PrivateState {
  readonly currentSecretKey: Uint8Array;
}

let currentCallerSecretKey: Uint8Array = OWNER_SK;
let privateState: PrivateState = { currentSecretKey: OWNER_SK };

const witnesses: Witnesses<PrivateState> = {
  localSecretKey: (ctx) => [
    ctx.privateState,
    ctx.privateState?.currentSecretKey ?? currentCallerSecretKey,
  ],
  getSchnorrReduction: (ctx, challengeHash: bigint) => {
    const q = challengeHash / TWO_248;
    const r = challengeHash % TWO_248;
    return [ctx.privateState, [q, r]];
  },
};

describe('FungibleToken v2.4 Contract Test Suite', () => {
  let contract: Contract<PrivateState>;
  let circuitContext: any;

  const setCallerSecretKey = (sk: Uint8Array) => {
    currentCallerSecretKey = sk;
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
    setCallerSecretKey(OWNER_SK);
    contract = new Contract(witnesses);
    const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
    const { currentContractState } = contract.initialState(
      constructorCtx,
      CONTRACT_SALT,
      ownerAccount,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_DECIMALS,
      TOKEN_MAX_SUPPLY,
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

  // =========================================================================
  // 1. Initial State & Constructor
  // =========================================================================
  describe('Initialization and Constructor', () => {
    it('should initialize ledger state correctly', () => {
      const state = getLedger();
      expect(state._name).toBe(TOKEN_NAME);
      expect(state._symbol).toBe(TOKEN_SYMBOL);
      expect(state._decimals).toBe(TOKEN_DECIMALS);
      expect(state._totalSupply).toBe(0n);
      expect(state._maxSupply).toBe(TOKEN_MAX_SUPPLY);
      expect(state.owner).toEqual(ownerAccount);
      expect(state._contractSalt).toEqual(CONTRACT_SALT);
      expect(state._paused).toBe(false);
      expect(state._emergencyPauser).toEqual(ownerAccount);
      expect(state._multisigThreshold).toBe(THRESHOLD);
      expect(state._multisigSignerCount).toBe(3n);
      expect(state._multisigNonce).toBe(0n);

      for (const signer of INITIAL_SIGNERS) {
        expect(state._multisigSigners.member(signer)).toBe(true);
      }
    });

    it('should default maxSupply to MAX_UINT128 if 0 is passed', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      const { currentContractState } = contract.initialState(
        constructorCtx,
        CONTRACT_SALT,
        ownerAccount,
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_DECIMALS,
        0n,
        INITIAL_SIGNERS,
        THRESHOLD
      );
      const state = ledger(currentContractState.data);
      expect(state._maxSupply).toBe(MAX_UINT128);
    });

    it('should fail constructor when threshold is 0 (< 1)', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() =>
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          ownerAccount,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          TOKEN_MAX_SUPPLY,
          INITIAL_SIGNERS,
          0n
        )
      ).toThrow('FungibleToken: invalid threshold');
    });

    it('should fail constructor when threshold is greater than 3', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() =>
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          ownerAccount,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          TOKEN_MAX_SUPPLY,
          INITIAL_SIGNERS,
          4n
        )
      ).toThrow('FungibleToken: invalid threshold');
    });

    it('should fail constructor with duplicate initial signers', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      const duplicateSigners: [Uint8Array, Uint8Array, Uint8Array] = [
        createKey(101),
        createKey(101),
        createKey(103),
      ];
      expect(() =>
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          ownerAccount,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          TOKEN_MAX_SUPPLY,
          duplicateSigners,
          THRESHOLD
        )
      ).toThrow('FungibleToken: duplicate initial signer');
    });
  });

  // =========================================================================
  // 2. Caller Authentication & Access Control
  // =========================================================================
  describe('Authentication and Access Control', () => {
    it('should fail authorization if caller secret key does not match account', () => {
      setCallerSecretKey(BOB_SK);
      // Alice account passed, but secret key is Bob's
      expect(() => runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 0n)).toThrow(
        'FungibleToken: caller authorization failed'
      );
    });

    it('should reject non-owner calls to owner-only circuits', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, aliceAccount, bobAccount, aliceAccount, 0n)
      ).toThrow('FungibleToken: only owner can call this');
    });

    it('should reject unauthorized caller from pausing or unpausing', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.pause, aliceAccount)).toThrow(
        'FungibleToken: only pauser or owner can call this'
      );
    });
  });

  // =========================================================================
  // 3. Pause and Emergency Stop
  // =========================================================================
  describe('Pause Mechanism', () => {
    it('should allow owner to pause and unpause', () => {
      setCallerSecretKey(OWNER_SK);
      const pauseRes = runCircuit(contract.circuits.pause, ownerAccount);
      expect(pauseRes).toBe(true);
      expect(getLedger()._paused).toBe(true);

      const unpauseRes = runCircuit(contract.circuits.unpause, ownerAccount);
      expect(unpauseRes).toBe(true);
      expect(getLedger()._paused).toBe(false);
    });

    it('should fail to pause when already paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);
      expect(() => runCircuit(contract.circuits.pause, ownerAccount)).toThrow(
        'FungibleToken: contract is paused'
      );
    });

    it('should fail to unpause when not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => runCircuit(contract.circuits.unpause, ownerAccount)).toThrow(
        'FungibleToken: contract is not paused'
      );
    });

    it('should block transfers when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 0n)).toThrow(
        'FungibleToken: contract is paused'
      );
    });

    it('should block approvals when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 100n)).toThrow(
        'FungibleToken: contract is paused'
      );
    });

    it('should block transferFrom when paused', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 100n);

      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(BOB_SK);
      expect(() =>
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, bobAccount, 0n)
      ).toThrow('FungibleToken: contract is paused');
    });

    it('should block selfBurn when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.selfBurn, aliceAccount, 0n)).toThrow(
        'FungibleToken: contract is paused'
      );
    });
  });

  // =========================================================================
  // 4. Standard Token Operations: Transfers
  // =========================================================================
  describe('Transfers', () => {
    it('should allow transferring 0 tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const res = runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 0n);
      expect(res).toBe(true);
      expect(getBalance(aliceAccount)).toBe(0n);
      expect(getBalance(bobAccount)).toBe(0n);
    });

    it('should allow self-transfer of 0 tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const res = runCircuit(contract.circuits.transfer, aliceAccount, aliceAccount, 0n);
      expect(res).toBe(true);
      expect(getBalance(aliceAccount)).toBe(0n);
    });

    it('should fail transfer to zero key', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.transfer, aliceAccount, zeroKey(), 0n)).toThrow(
        'FungibleToken: invalid receiver'
      );
    });

    it('should fail transfer when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 100n)).toThrow(
        'FungibleToken: insufficient balance'
      );
    });

    it('should fail self-transfer when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.transfer, aliceAccount, aliceAccount, 100n)).toThrow(
        'FungibleToken: insufficient balance'
      );
    });
  });

  // =========================================================================
  // 5. Approvals and Allowances
  // =========================================================================
  describe('Approvals and Allowances', () => {
    it('should approve allowance for a spender and query state directly', () => {
      setCallerSecretKey(ALICE_SK);
      const res = runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 500n);
      expect(res).toBe(true);
      expect(getAllowance(aliceAccount, bobAccount)).toBe(500n);
    });

    it('should update and overwrite existing allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 500n);
      expect(getAllowance(aliceAccount, bobAccount)).toBe(500n);

      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 1000n);
      expect(getAllowance(aliceAccount, bobAccount)).toBe(1000n);

      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 0n);
      expect(getAllowance(aliceAccount, bobAccount)).toBe(0n);
    });

    it('should fail approval to zero key spender', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.approve, aliceAccount, zeroKey(), 500n)).toThrow(
        'FungibleToken: invalid spender'
      );
    });
  });

  // =========================================================================
  // 6. TransferFrom Operations
  // =========================================================================
  describe('TransferFrom Operations', () => {
    it('should transferFrom with sufficient allowance and reduce allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 200n);
      expect(getAllowance(aliceAccount, bobAccount)).toBe(200n);

      setCallerSecretKey(BOB_SK);
      const res = runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, bobAccount, 0n);
      expect(res).toBe(true);
      expect(getAllowance(aliceAccount, bobAccount)).toBe(200n);
    });

    it('should fail transferFrom with insufficient allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 50n);

      setCallerSecretKey(BOB_SK);
      expect(() =>
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, bobAccount, 100n)
      ).toThrow('FungibleToken: insufficient allowance');
    });

    it('should fail transferFrom when balance is insufficient even with sufficient allowance', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 1000n);

      setCallerSecretKey(BOB_SK);
      expect(() =>
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, bobAccount, 100n)
      ).toThrow('FungibleToken: insufficient balance');
    });

    it('should not decrement infinite allowance (MAX_UINT128)', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, MAX_UINT128);

      setCallerSecretKey(BOB_SK);
      runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, bobAccount, 0n);
      expect(getAllowance(aliceAccount, bobAccount)).toBe(MAX_UINT128);
    });
  });

  // =========================================================================
  // 7. Self Burn
  // =========================================================================
  describe('Self Burn', () => {
    it('should allow self-burn of 0 tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const res = runCircuit(contract.circuits.selfBurn, aliceAccount, 0n);
      expect(res).toBe(true);
      expect(getBalance(aliceAccount)).toBe(0n);
      expect(getLedger()._totalSupply).toBe(0n);
    });

    it('should fail self-burn with insufficient balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.selfBurn, aliceAccount, 10n)).toThrow(
        'FungibleToken: insufficient balance'
      );
    });
  });

  // =========================================================================
  // 8. Admin Reallocate
  // =========================================================================
  describe('Admin Reallocate', () => {
    it('should allow owner to reallocate 0 tokens', () => {
      setCallerSecretKey(OWNER_SK);
      const res = runCircuit(
        contract.circuits.adminReallocate,
        ownerAccount,
        aliceAccount,
        bobAccount,
        0n
      );
      expect(res).toBe(true);
    });

    it('should fail reallocate if sender has insufficient balance', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, ownerAccount, aliceAccount, bobAccount, 50n)
      ).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail reallocate to zero key', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, ownerAccount, aliceAccount, zeroKey(), 0n)
      ).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail reallocate from zero key', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, ownerAccount, zeroKey(), bobAccount, 0n)
      ).toThrow('FungibleToken: invalid sender');
    });

    it('should reject non-owner calling adminReallocate', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, aliceAccount, bobAccount, aliceAccount, 0n)
      ).toThrow('FungibleToken: only owner can call this');
    });
  });

  // =========================================================================
  // 9. Emergency Withdrawal
  // =========================================================================
  describe('Emergency Withdrawal', () => {
    const dummyExternalToken = { bytes: new Uint8Array(32).fill(2) };

    it('should fail emergency withdrawal when not paused', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, ownerAccount, dummyExternalToken, 0n)
      ).toThrow('FungibleToken: contract is not paused');
    });

    it('should fail emergency withdrawal when called by non-owner even if paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, aliceAccount, dummyExternalToken, 0n)
      ).toThrow('FungibleToken: only owner can call this');
    });

    it('should allow owner to emergency withdraw 0 tokens when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);
      const res = runCircuit(
        contract.circuits.emergencyWithdraw,
        ownerAccount,
        dummyExternalToken,
        0n
      );
      expect(res).toBe(true);
    });

    it('should fail emergency withdrawal when contract account balance is insufficient', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, ownerAccount, dummyExternalToken, 100n)
      ).toThrow('FungibleToken: insufficient balance');
    });
  });

  // =========================================================================
  // 10. Multi-Sig Governed Operations: Mint, Burn, SetEmergencyPauser
  // =========================================================================
  describe('Multi-Sig Governed Mint', () => {
    it('should fail mint when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.mint, aliceAccount, 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: contract is paused');
    });

    it('should fail mint with invalid zero receiver', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.mint, zeroKey(), 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail mint with duplicate signers', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_A]; // duplicate pubkeys
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.mint, aliceAccount, 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: duplicate signer detected');
    });

    it('should fail mint when signers are not registered', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.mint, aliceAccount, 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: signer not registered');
    });
  });

  describe('Multi-Sig Governed Burn', () => {
    it('should fail burn when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.burn, aliceAccount, 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: contract is paused');
    });

    it('should fail burn with invalid zero sender', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.burn, zeroKey(), 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: invalid sender');
    });

    it('should fail burn with duplicate signers', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_A];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.burn, aliceAccount, 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: duplicate signer detected');
    });

    it('should fail burn when signers are not registered', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.burn, aliceAccount, 100n, pubkeys, sigs)
      ).toThrow('FungibleToken: signer not registered');
    });
  });

  describe('Multi-Sig Governed SetEmergencyPauser', () => {
    it('should fail setEmergencyPauser with zero address', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.setEmergencyPauser, zeroKey(), pubkeys, sigs)
      ).toThrow('FungibleToken: invalid pauser address');
    });

    it('should fail setEmergencyPauser with duplicate signers', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_A];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.setEmergencyPauser, pauserAccount, pubkeys, sigs)
      ).toThrow('FungibleToken: duplicate signer detected');
    });

    it('should fail setEmergencyPauser when signers are not registered', () => {
      const pubkeys = [DUMMY_POINT_A, DUMMY_POINT_B];
      const sigs = [DUMMY_SIGNATURE, DUMMY_SIGNATURE];
      expect(() =>
        runCircuit(contract.circuits.setEmergencyPauser, pauserAccount, pubkeys, sigs)
      ).toThrow('FungibleToken: signer not registered');
    });
  });
});