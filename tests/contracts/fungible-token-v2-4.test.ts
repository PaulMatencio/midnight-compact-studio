import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

// ============ Type Definitions & Constants ============

interface PrivateState {
  currentSecretKey: Uint8Array;
}

const createKey = (byteValue: number): Uint8Array => new Uint8Array(32).fill(byteValue);

const dummyContractAddress = '00'.repeat(32);
const dummyCoinPublicKey = '01'.repeat(32);

const CONTRACT_SALT = createKey(7);
const TOKEN_NAME = 'Midnight Fungible Token';
const TOKEN_SYMBOL = 'MFT';
const DECIMALS = 8n;
const MAX_SUPPLY = 1_000_000n;
const MAX_UINT128 = 340282366920938463463374607431768211455n;
const TWO_248 = 1n << 248n; // 452312848583266388373324160190187140051835877600158453279131187530910662656n

// Secret Keys
const OWNER_SK = createKey(1);
const ALICE_SK = createKey(2);
const BOB_SK = createKey(3);
const CHARLIE_SK = createKey(4);
const UNAUTHORIZED_SK = createKey(9);

// Signer Commitments
const SIGNER_1 = createKey(11);
const SIGNER_2 = createKey(12);
const SIGNER_3 = createKey(13);
const INITIAL_SIGNERS: [Uint8Array, Uint8Array, Uint8Array] = [SIGNER_1, SIGNER_2, SIGNER_3];
const THRESHOLD = 2n;

// Multi-sig Mock Structs
const mockPubkey1 = { x: 101n, y: 102n };
const mockPubkey2 = { x: 201n, y: 202n };
const mockSignature1 = { announcement: { x: 11n, y: 12n }, response: 13n };
const mockSignature2 = { announcement: { x: 21n, y: 22n }, response: 23n };

// Helpers for zero-key representation
const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);

// ============ Dynamic Persistent Hash Discovery for Authentication ============

const domainTagAuth = new Uint8Array(32);
domainTagAuth.set(new TextEncoder().encode('fungible-token:auth'));

const dummySalt = new Uint8Array(32).fill(7);
const helperContract = new Contract({
  localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
  getSchnorrReduction: (ctx: any, ch: bigint) => [ctx.privateState, [0n, 0n]],
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

// ============ Test Suite ============

describe('FungibleToken Contract v2.4', () => {
  let contract: Contract<PrivateState>;
  let circuitContext: any;
  let currentCallerSecretKey: Uint8Array;
  let privateState: PrivateState;

  let ownerAccount: Uint8Array;
  let aliceAccount: Uint8Array;
  let bobAccount: Uint8Array;
  let charlieAccount: Uint8Array;
  let unauthorizedAccount: Uint8Array;

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
      const q = challengeHash / TWO_248;
      const r = challengeHash % TWO_248;
      return [ctx.privateState, [q, r]];
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

  const getAllowance = (owner: Uint8Array, spender: Uint8Array): bigint => {
    const l = getLedger();
    const key: [Uint8Array, Uint8Array] = [owner, spender];
    return l._allowances.member(key) ? l._allowances.lookup(key) : 0n;
  };

  beforeEach(() => {
    contract = new Contract(witnesses);
    currentCallerSecretKey = OWNER_SK;
    privateState = { currentSecretKey: OWNER_SK };

    ownerAccount = deriveAccount(OWNER_SK);
    aliceAccount = deriveAccount(ALICE_SK);
    bobAccount = deriveAccount(BOB_SK);
    charlieAccount = deriveAccount(CHARLIE_SK);
    unauthorizedAccount = deriveAccount(UNAUTHORIZED_SK);

    const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
    const { currentContractState } = contract.initialState(
      constructorCtx,
      CONTRACT_SALT,
      ownerAccount,
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

  describe('Constructor & Deployment Invariants', () => {
    it('initializes public ledger fields correctly', () => {
      const state = getLedger();
      expect(state._name).toBe(TOKEN_NAME);
      expect(state._symbol).toBe(TOKEN_SYMBOL);
      expect(state._decimals).toBe(DECIMALS);
      expect(state._totalSupply).toBe(0n);
      expect(state._maxSupply).toBe(MAX_SUPPLY);
      expect(state.owner).toEqual(ownerAccount);
      expect(state._contractSalt).toEqual(CONTRACT_SALT);
      expect(state._paused).toBe(false);
      expect(state._emergencyPauser).toEqual(ownerAccount);
      expect(state._multisigThreshold).toBe(THRESHOLD);
      expect(state._multisigSignerCount).toBe(3n);
      expect(state._multisigNonce).toBe(0n);
      expect(state._multisigSigners.member(SIGNER_1)).toBe(true);
      expect(state._multisigSigners.member(SIGNER_2)).toBe(true);
      expect(state._multisigSigners.member(SIGNER_3)).toBe(true);
    });

    it('defaults _maxSupply to MAX_UINT128 if maxSupply_ is 0', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      const { currentContractState } = contract.initialState(
        constructorCtx,
        CONTRACT_SALT,
        ownerAccount,
        TOKEN_NAME,
        TOKEN_SYMBOL,
        DECIMALS,
        0n,
        INITIAL_SIGNERS,
        THRESHOLD
      );
      const state = ledger(currentContractState.data);
      expect(state._maxSupply).toBe(MAX_UINT128);
    });

    it('rejects deployment if threshold is 0', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() =>
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          ownerAccount,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          DECIMALS,
          MAX_SUPPLY,
          INITIAL_SIGNERS,
          0n
        )
      ).toThrow('FungibleToken: invalid threshold');
    });

    it('rejects deployment if threshold is greater than 3', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() =>
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          ownerAccount,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          DECIMALS,
          MAX_SUPPLY,
          INITIAL_SIGNERS,
          4n
        )
      ).toThrow('FungibleToken: invalid threshold');
    });

    it('rejects deployment if duplicate initial signers exist', () => {
      const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      const duplicateSigners: [Uint8Array, Uint8Array, Uint8Array] = [SIGNER_1, SIGNER_1, SIGNER_3];
      expect(() =>
        contract.initialState(
          constructorCtx,
          CONTRACT_SALT,
          ownerAccount,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          DECIMALS,
          MAX_SUPPLY,
          duplicateSigners,
          THRESHOLD
        )
      ).toThrow('FungibleToken: duplicate initial signer');
    });
  });

  describe('Multi-Sig View Circuits', () => {
    it('returns the current multisig nonce via circuit', () => {
      const nonce = runCircuit(contract.circuits.getMultisigNonce);
      expect(nonce).toBe(0n);
    });

    it('returns the current multisig threshold via circuit', () => {
      const threshold = runCircuit(contract.circuits.getMultisigThreshold);
      expect(threshold).toBe(THRESHOLD);
    });

    it('returns the multisig signer count via circuit', () => {
      const signerCount = runCircuit(contract.circuits.getMultisigSignerCount);
      expect(signerCount).toBe(3n);
    });

    it('verifies membership of registered and unregistered signers', () => {
      expect(runCircuit(contract.circuits.isMultisigSigner, SIGNER_1)).toBe(true);
      expect(runCircuit(contract.circuits.isMultisigSigner, SIGNER_2)).toBe(true);
      expect(runCircuit(contract.circuits.isMultisigSigner, SIGNER_3)).toBe(true);
      expect(runCircuit(contract.circuits.isMultisigSigner, createKey(99))).toBe(false);
    });
  });

  describe('Emergency Stop (Pause / Unpause)', () => {
    it('allows the owner to pause and unpause the contract', () => {
      setCallerSecretKey(OWNER_SK);
      expect(getLedger()._paused).toBe(false);

      const pauseRes = runCircuit(contract.circuits.pause, ownerAccount);
      expect(pauseRes).toBe(true);
      expect(getLedger()._paused).toBe(true);

      const unpauseRes = runCircuit(contract.circuits.unpause, ownerAccount);
      expect(unpauseRes).toBe(true);
      expect(getLedger()._paused).toBe(false);
    });

    it('rejects pause call from an unauthorized account', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.pause, aliceAccount)).toThrow(
        'FungibleToken: only pauser or owner can call this'
      );
    });

    it('rejects unpause call from an unauthorized account', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.unpause, aliceAccount)).toThrow(
        'FungibleToken: only pauser or owner can call this'
      );
    });

    it('fails when pausing an already paused contract', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);
      expect(() => runCircuit(contract.circuits.pause, ownerAccount)).toThrow(
        'FungibleToken: contract is paused'
      );
    });

    it('fails when unpausing an unpaused contract', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => runCircuit(contract.circuits.unpause, ownerAccount)).toThrow(
        'FungibleToken: contract is not paused'
      );
    });

    it('fails authentication if caller account does not match secret key', () => {
      setCallerSecretKey(ALICE_SK);
      // Alice tries to claim she is the owner
      expect(() => runCircuit(contract.circuits.pause, ownerAccount)).toThrow(
        'FungibleToken: caller authorization failed'
      );
    });
  });

  describe('Token Allowances and TransferFrom', () => {
    it('allows an account to approve a spender and reads allowance from ledger', () => {
      setCallerSecretKey(OWNER_SK);
      expect(getAllowance(ownerAccount, aliceAccount)).toBe(0n);

      const approveRes = runCircuit(contract.circuits.approve, ownerAccount, aliceAccount, 500n);
      expect(approveRes).toBe(true);
      expect(getAllowance(ownerAccount, aliceAccount)).toBe(500n);

      // Overwriting allowance
      runCircuit(contract.circuits.approve, ownerAccount, aliceAccount, 250n);
      expect(getAllowance(ownerAccount, aliceAccount)).toBe(250n);
    });

    it('rejects approve with invalid spender (zero address)', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => runCircuit(contract.circuits.approve, ownerAccount, zeroKey(), 100n)).toThrow(
        'FungibleToken: invalid spender'
      );
    });

    it('rejects approve when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      expect(() => runCircuit(contract.circuits.approve, ownerAccount, aliceAccount, 100n)).toThrow(
        'FungibleToken: contract is paused'
      );
    });

    it('rejects transferFrom when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.approve, ownerAccount, aliceAccount, 100n);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.transferFrom, aliceAccount, ownerAccount, bobAccount, 50n)
      ).toThrow('FungibleToken: contract is paused');
    });

    it('rejects transferFrom when allowance is insufficient', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.approve, ownerAccount, aliceAccount, 50n);

      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.transferFrom, aliceAccount, ownerAccount, bobAccount, 100n)
      ).toThrow('FungibleToken: insufficient allowance');
    });

    it('spends allowance and enforces balance check during transferFrom', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.approve, ownerAccount, aliceAccount, 100n);

      setCallerSecretKey(ALICE_SK);
      // Owner has 0 balance, so transferFrom must fail with insufficient balance
      expect(() =>
        runCircuit(contract.circuits.transferFrom, aliceAccount, ownerAccount, bobAccount, 50n)
      ).toThrow('FungibleToken: insufficient balance');
    });
  });

  describe('Standard Token Transfers & Self Burn', () => {
    it('allows self-transfer of 0 tokens even with zero balance', () => {
      setCallerSecretKey(OWNER_SK);
      const res = runCircuit(contract.circuits.transfer, ownerAccount, ownerAccount, 0n);
      expect(res).toBe(true);
      expect(getBalance(ownerAccount)).toBe(0n);
    });

    it('rejects transfer with invalid receiver (zero address)', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => runCircuit(contract.circuits.transfer, ownerAccount, zeroKey(), 100n)).toThrow(
        'FungibleToken: invalid receiver'
      );
    });

    it('rejects transfer when balance is insufficient', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => runCircuit(contract.circuits.transfer, ownerAccount, aliceAccount, 50n)).toThrow(
        'FungibleToken: insufficient balance'
      );
    });

    it('rejects transfer when contract is paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      expect(() => runCircuit(contract.circuits.transfer, ownerAccount, aliceAccount, 0n)).toThrow(
        'FungibleToken: contract is paused'
      );
    });

    it('rejects transfer if caller authorization fails', () => {
      setCallerSecretKey(ALICE_SK);
      // Alice calls with owner's public account
      expect(() => runCircuit(contract.circuits.transfer, ownerAccount, bobAccount, 10n)).toThrow(
        'FungibleToken: caller authorization failed'
      );
    });

    it('rejects selfBurn when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.selfBurn, aliceAccount, 10n)).toThrow(
        'FungibleToken: insufficient balance'
      );
    });

    it('rejects selfBurn when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      expect(() => runCircuit(contract.circuits.selfBurn, aliceAccount, 0n)).toThrow(
        'FungibleToken: contract is paused'
      );
    });
  });

  describe('Admin Operations', () => {
    it('rejects adminReallocate when called by non-owner', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, aliceAccount, bobAccount, charlieAccount, 100n)
      ).toThrow('FungibleToken: only owner can call this');
    });

    it('rejects adminReallocate with invalid receiver (zero key)', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, ownerAccount, bobAccount, zeroKey(), 100n)
      ).toThrow('FungibleToken: invalid receiver');
    });

    it('rejects adminReallocate with invalid sender (zero key)', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, ownerAccount, zeroKey(), bobAccount, 100n)
      ).toThrow('FungibleToken: invalid sender');
    });

    it('rejects adminReallocate when trapped account has insufficient balance', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() =>
        runCircuit(contract.circuits.adminReallocate, ownerAccount, bobAccount, charlieAccount, 100n)
      ).toThrow('FungibleToken: insufficient balance');
    });

    it('rejects emergencyWithdraw when not paused', () => {
      setCallerSecretKey(OWNER_SK);
      const dummyToken = { bytes: createKey(88) };
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, ownerAccount, dummyToken, 50n)
      ).toThrow('FungibleToken: contract is not paused');
    });

    it('rejects emergencyWithdraw called by non-owner when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      setCallerSecretKey(ALICE_SK);
      const dummyToken = { bytes: createKey(88) };
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, aliceAccount, dummyToken, 50n)
      ).toThrow('FungibleToken: only owner can call this');
    });

    it('rejects emergencyWithdraw when contract account has insufficient balance', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, ownerAccount);

      const dummyToken = { bytes: createKey(88) };
      expect(() =>
        runCircuit(contract.circuits.emergencyWithdraw, ownerAccount, dummyToken, 50n)
      ).toThrow('FungibleToken: insufficient balance');
    });
  });

  describe('Multi-Sig Governed Operations (Validation & Security)', () => {
    describe('mint()', () => {
      it('rejects minting when contract is paused', () => {
        setCallerSecretKey(OWNER_SK);
        runCircuit(contract.circuits.pause, ownerAccount);

        expect(() =>
          runCircuit(
            contract.circuits.mint,
            aliceAccount,
            100n,
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: contract is paused');
      });

      it('rejects minting to zero key address', () => {
        expect(() =>
          runCircuit(
            contract.circuits.mint,
            zeroKey(),
            100n,
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: invalid receiver');
      });

      it('rejects minting with duplicate signers', () => {
        const duplicatePubkeys: [{ x: bigint; y: bigint }, { x: bigint; y: bigint }] = [
          mockPubkey1,
          mockPubkey1,
        ];
        expect(() =>
          runCircuit(
            contract.circuits.mint,
            aliceAccount,
            100n,
            duplicatePubkeys,
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: duplicate signer detected');
      });

      it('rejects minting if signer is not registered in _multisigSigners', () => {
        expect(() =>
          runCircuit(
            contract.circuits.mint,
            aliceAccount,
            100n,
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: signer not registered');
      });
    });

    describe('burn()', () => {
      it('rejects burning when contract is paused', () => {
        setCallerSecretKey(OWNER_SK);
        runCircuit(contract.circuits.pause, ownerAccount);

        expect(() =>
          runCircuit(
            contract.circuits.burn,
            aliceAccount,
            50n,
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: contract is paused');
      });

      it('rejects burning from zero key address', () => {
        expect(() =>
          runCircuit(
            contract.circuits.burn,
            zeroKey(),
            50n,
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: invalid sender');
      });

      it('rejects burning with duplicate signers', () => {
        const duplicatePubkeys: [{ x: bigint; y: bigint }, { x: bigint; y: bigint }] = [
          mockPubkey1,
          mockPubkey1,
        ];
        expect(() =>
          runCircuit(
            contract.circuits.burn,
            aliceAccount,
            50n,
            duplicatePubkeys,
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: duplicate signer detected');
      });

      it('rejects burning if signer is not registered', () => {
        expect(() =>
          runCircuit(
            contract.circuits.burn,
            aliceAccount,
            50n,
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: signer not registered');
      });
    });

    describe('setEmergencyPauser()', () => {
      it('rejects setEmergencyPauser with zero address', () => {
        expect(() =>
          runCircuit(
            contract.circuits.setEmergencyPauser,
            zeroKey(),
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: invalid pauser address');
      });

      it('rejects setEmergencyPauser with duplicate signers', () => {
        const duplicatePubkeys: [{ x: bigint; y: bigint }, { x: bigint; y: bigint }] = [
          mockPubkey1,
          mockPubkey1,
        ];
        expect(() =>
          runCircuit(
            contract.circuits.setEmergencyPauser,
            bobAccount,
            duplicatePubkeys,
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: duplicate signer detected');
      });

      it('rejects setEmergencyPauser if signer is not registered', () => {
        expect(() =>
          runCircuit(
            contract.circuits.setEmergencyPauser,
            bobAccount,
            [mockPubkey1, mockPubkey2],
            [mockSignature1, mockSignature2]
          )
        ).toThrow('FungibleToken: signer not registered');
      });
    });
  });
});