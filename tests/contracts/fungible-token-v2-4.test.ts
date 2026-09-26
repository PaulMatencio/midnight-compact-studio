import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

// ============ Private State & Types ============
interface PrivateState {
  readonly currentSecretKey: Uint8Array;
}

// 2^248 as defined in Jubjub Schnorr reduction
const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;
const MAX_UINT128 = 340282366920938463463374607431768211455n;

// ============ Deterministic Test Helpers ============
const createKey = (byteVal: number): Uint8Array => new Uint8Array(32).fill(byteVal);
const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);

const pad32 = (str: string): Uint8Array => {
  const arr = new Uint8Array(32);
  const encoded = new TextEncoder().encode(str);
  arr.set(encoded.subarray(0, 32));
  return arr;
};

const domainTagAuth = pad32('fungible-token:auth');

const CONTRACT_SALT = createKey(99);
const OWNER_SK = createKey(1);
const ALICE_SK = createKey(2);
const BOB_SK = createKey(3);
const PAUSER_SK = createKey(4);
const UNAUTHORIZED_SK = createKey(5);

const SIGNER_1 = createKey(11);
const SIGNER_2 = createKey(12);
const SIGNER_3 = createKey(13);
const INITIAL_SIGNERS: [Uint8Array, Uint8Array, Uint8Array] = [SIGNER_1, SIGNER_2, SIGNER_3];

const dummyContractAddress = '00'.repeat(32);
const dummyCoinPublicKey = '01'.repeat(32);

const TOKEN_NAME = 'Privacy Token';
const TOKEN_SYMBOL = 'PRV';
const TOKEN_DECIMALS = 18n;
const MAX_SUPPLY = 1_000_000n;

// Dummy Jubjub points and Schnorr signatures for multi-sig validation checks
const dummyPoint1 = { x: 0n, y: 1n };
const dummyPoint2 = { x: 1n, y: 0n };
const dummySig = { announcement: { x: 0n, y: 1n }, response: 0n };

// ============ Dynamic Persistent Hash Account Derivation ============
const helperContract = new Contract({
  localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
  getSchnorrReduction: (ctx: any, ch: bigint) => [ctx.privateState, [ch / TWO_248, ch % TWO_248]],
});

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

const OWNER = deriveAccount(OWNER_SK);
const ALICE = deriveAccount(ALICE_SK);
const BOB = deriveAccount(BOB_SK);
const PAUSER = deriveAccount(PAUSER_SK);
const UNAUTHORIZED = deriveAccount(UNAUTHORIZED_SK);

describe('FungibleToken v2.4 Contract Suite', () => {
  let contract: Contract<PrivateState>;
  let circuitContext: any;
  let currentCallerSecretKey: Uint8Array = OWNER_SK;
  let privateState: PrivateState = { currentSecretKey: OWNER_SK };

  // Double-insulated witness implementation
  const witnesses: Witnesses<PrivateState> = {
    localSecretKey: (ctx) => [
      ctx.privateState,
      ctx.privateState?.currentSecretKey ?? currentCallerSecretKey,
    ],
    getSchnorrReduction: (ctx, challengeHash: bigint) => [
      ctx.privateState,
      [challengeHash / TWO_248, challengeHash % TWO_248],
    ],
  };

  // Synchronize private state when switching caller identities
  const setCallerSecretKey = (sk: Uint8Array) => {
    currentCallerSecretKey = sk;
    privateState = { currentSecretKey: sk };
    if (circuitContext) {
      circuitContext.currentPrivateState = privateState;
    }
  };

  // Auto-normalizing circuit execution wrapper with context synchronization
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

  // Direct public ledger query accessors
  const getLedger = () => ledger(circuitContext.currentQueryContext.state);

  const getBalance = (account: Uint8Array): bigint => {
    const l = getLedger();
    return l._balances.member(account) ? l._balances.lookup(account) : 0n;
  };

  const getAllowance = (ownerAccount: Uint8Array, spender: Uint8Array): bigint => {
    const l = getLedger();
    const key: [Uint8Array, Uint8Array] = [ownerAccount, spender];
    return l._allowances.member(key) ? l._allowances.lookup(key) : 0n;
  };

  beforeEach(() => {
    setCallerSecretKey(OWNER_SK);
    contract = new Contract(witnesses);

    const constructorCtx = CompactRuntime.createConstructorContext(
      privateState,
      dummyCoinPublicKey
    );

    const { currentContractState } = contract.initialState(
      constructorCtx,
      CONTRACT_SALT,
      OWNER,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_DECIMALS,
      MAX_SUPPLY,
      INITIAL_SIGNERS,
      2n
    );

    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      currentContractState.data,
      privateState
    );
  });

  describe('Constructor & Initialization', () => {
    it('should correctly initialize all public ledger state fields', () => {
      const state = getLedger();
      expect(state._name).toBe(TOKEN_NAME);
      expect(state._symbol).toBe(TOKEN_SYMBOL);
      expect(state._decimals).toBe(TOKEN_DECIMALS);
      expect(state._totalSupply).toBe(0n);
      expect(state._maxSupply).toBe(MAX_SUPPLY);
      expect(state.owner).toEqual(OWNER);
      expect(state._emergencyPauser).toEqual(OWNER);
      expect(state._paused).toBe(false);
      expect(state._multisigThreshold).toBe(2n);
      expect(state._multisigSignerCount).toBe(3n);
      expect(state._multisigNonce).toBe(0n);

      expect(state._multisigSigners.member(SIGNER_1)).toBe(true);
      expect(state._multisigSigners.member(SIGNER_2)).toBe(true);
      expect(state._multisigSigners.member(SIGNER_3)).toBe(true);
    });

    it('should set maxSupply to MAX_UINT128 if 0 is passed to constructor', () => {
      const freshContract = new Contract(witnesses);
      const ctx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      const { currentContractState } = freshContract.initialState(
        ctx,
        CONTRACT_SALT,
        OWNER,
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_DECIMALS,
        0n,
        INITIAL_SIGNERS,
        2n
      );
      const state = ledger(currentContractState.data);
      expect(state._maxSupply).toBe(MAX_UINT128);
    });

    it('should reject threshold below 1 in constructor', () => {
      const freshContract = new Contract(witnesses);
      const ctx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() => {
        freshContract.initialState(
          ctx,
          CONTRACT_SALT,
          OWNER,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          MAX_SUPPLY,
          INITIAL_SIGNERS,
          0n
        );
      }).toThrow('FungibleToken: invalid threshold');
    });

    it('should reject threshold greater than 3 in constructor', () => {
      const freshContract = new Contract(witnesses);
      const ctx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      expect(() => {
        freshContract.initialState(
          ctx,
          CONTRACT_SALT,
          OWNER,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          MAX_SUPPLY,
          INITIAL_SIGNERS,
          4n
        );
      }).toThrow('FungibleToken: invalid threshold');
    });

    it('should reject duplicate initial signers in constructor', () => {
      const freshContract = new Contract(witnesses);
      const ctx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
      const duplicateSigners: [Uint8Array, Uint8Array, Uint8Array] = [SIGNER_1, SIGNER_1, SIGNER_3];
      expect(() => {
        freshContract.initialState(
          ctx,
          CONTRACT_SALT,
          OWNER,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          MAX_SUPPLY,
          duplicateSigners,
          2n
        );
      }).toThrow('FungibleToken: duplicate initial signer');
    });
  });

  describe('Authentication & Access Control', () => {
    it('should authenticate correctly when secret key matches account', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, ALICE, BOB, 0n);
      expect(success).toBe(true);
    });

    it('should fail authentication if caller secret key does not correspond to account', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, BOB, 0n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should reject unauthorized caller invoking onlyOwner circuits', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.adminReallocate, ALICE, BOB, ALICE, 0n);
      }).toThrow('FungibleToken: only owner can call this');
    });

    it('should reject unauthorized caller invoking pause', () => {
      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.pause, UNAUTHORIZED);
      }).toThrow('FungibleToken: only pauser or owner can call this');
    });

    it('should reject unauthorized caller invoking unpause', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER);

      setCallerSecretKey(UNAUTHORIZED_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, UNAUTHORIZED);
      }).toThrow('FungibleToken: only pauser or owner can call this');
    });
  });

  describe('Pause & Emergency Stop Mechanism', () => {
    it('should allow owner to pause and unpause the contract', () => {
      setCallerSecretKey(OWNER_SK);
      expect(getLedger()._paused).toBe(false);

      const pausedRes = runCircuit(contract.circuits.pause, OWNER);
      expect(pausedRes).toBe(true);
      expect(getLedger()._paused).toBe(true);

      const unpausedRes = runCircuit(contract.circuits.unpause, OWNER);
      expect(unpausedRes).toBe(true);
      expect(getLedger()._paused).toBe(false);
    });

    it('should fail when pausing an already paused contract', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER);

      expect(() => {
        runCircuit(contract.circuits.pause, OWNER);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should fail when unpausing an already active contract', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.unpause, OWNER);
      }).toThrow('FungibleToken: contract is not paused');
    });

    it('should block transfers when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, BOB, 0n);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should block approvals when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE, BOB, 100n);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should block transferFrom when paused', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 100n);

      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, BOB, 0n);
      }).toThrow('FungibleToken: contract is paused');
    });

    it('should block selfBurn when paused', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.pause, OWNER);

      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.selfBurn, ALICE, 0n);
      }).toThrow('FungibleToken: contract is paused');
    });
  });

  describe('Standard Token Operations - Transfer', () => {
    it('should allow zero-amount transfer between accounts', () => {
      setCallerSecretKey(ALICE_SK);
      const res = runCircuit(contract.circuits.transfer, ALICE, BOB, 0n);
      expect(res).toBe(true);
      expect(getBalance(ALICE)).toBe(0n);
      expect(getBalance(BOB)).toBe(0n);
    });

    it('should allow self-transfer of zero amount', () => {
      setCallerSecretKey(ALICE_SK);
      const res = runCircuit(contract.circuits.transfer, ALICE, ALICE, 0n);
      expect(res).toBe(true);
      expect(getBalance(ALICE)).toBe(0n);
    });

    it('should fail transfer when balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, BOB, 100n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should reject transfer to zero address', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, zeroKey(), 0n);
      }).toThrow('FungibleToken: invalid receiver');
    });
  });

  describe('Standard Token Operations - Approve & TransferFrom', () => {
    it('should approve spender and store allowance in ledger', () => {
      setCallerSecretKey(ALICE_SK);
      expect(getAllowance(ALICE, BOB)).toBe(0n);

      const res = runCircuit(contract.circuits.approve, ALICE, BOB, 500n);
      expect(res).toBe(true);
      expect(getAllowance(ALICE, BOB)).toBe(500n);
    });

    it('should overwrite existing allowance on new approval', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 500n);
      expect(getAllowance(ALICE, BOB)).toBe(500n);

      runCircuit(contract.circuits.approve, ALICE, BOB, 250n);
      expect(getAllowance(ALICE, BOB)).toBe(250n);
    });

    it('should reject approval with zero spender address', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE, zeroKey(), 100n);
      }).toThrow('FungibleToken: invalid spender');
    });

    it('should fail transferFrom if allowance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 100n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, BOB, 200n);
      }).toThrow('FungibleToken: insufficient allowance');
    });

    it('should fail transferFrom if allowance is sufficient but balance is insufficient', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 100n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, BOB, 50n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should allow transferFrom of zero tokens and decrement allowance below MAX_UINT128', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, 100n);

      setCallerSecretKey(BOB_SK);
      const res = runCircuit(contract.circuits.transferFrom, BOB, ALICE, BOB, 0n);
      expect(res).toBe(true);
      expect(getAllowance(ALICE, BOB)).toBe(100n);
    });

    it('should not decrement allowance when allowance is MAX_UINT128', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, ALICE, BOB, MAX_UINT128);
      expect(getAllowance(ALICE, BOB)).toBe(MAX_UINT128);

      setCallerSecretKey(BOB_SK);
      const res = runCircuit(contract.circuits.transferFrom, BOB, ALICE, BOB, 0n);
      expect(res).toBe(true);
      expect(getAllowance(ALICE, BOB)).toBe(MAX_UINT128);
    });
  });

  describe('Standard Token Operations - SelfBurn', () => {
    it('should reject selfBurn if account has insufficient balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.selfBurn, ALICE, 100n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should allow selfBurn of zero amount without altering total supply', () => {
      setCallerSecretKey(ALICE_SK);
      const initialSupply = getLedger()._totalSupply;
      const res = runCircuit(contract.circuits.selfBurn, ALICE, 0n);
      expect(res).toBe(true);
      expect(getLedger()._totalSupply).toBe(initialSupply);
      expect(getBalance(ALICE)).toBe(0n);
    });
  });

  describe('Admin & Emergency Operations', () => {
    describe('adminReallocate', () => {
      it('should allow owner to execute adminReallocate for zero tokens', () => {
        setCallerSecretKey(OWNER_SK);
        const res = runCircuit(contract.circuits.adminReallocate, OWNER, ALICE, BOB, 0n);
        expect(res).toBe(true);
        expect(getBalance(ALICE)).toBe(0n);
        expect(getBalance(BOB)).toBe(0n);
      });

      it('should reject adminReallocate with insufficient balance on trapped account', () => {
        setCallerSecretKey(OWNER_SK);
        expect(() => {
          runCircuit(contract.circuits.adminReallocate, OWNER, ALICE, BOB, 100n);
        }).toThrow('FungibleToken: insufficient balance');
      });

      it('should reject adminReallocate if caller is not owner', () => {
        setCallerSecretKey(ALICE_SK);
        expect(() => {
          runCircuit(contract.circuits.adminReallocate, ALICE, ALICE, BOB, 0n);
        }).toThrow('FungibleToken: only owner can call this');
      });

      it('should reject adminReallocate with zero trapped account', () => {
        setCallerSecretKey(OWNER_SK);
        expect(() => {
          runCircuit(contract.circuits.adminReallocate, OWNER, zeroKey(), BOB, 0n);
        }).toThrow('FungibleToken: invalid sender');
      });

      it('should reject adminReallocate with zero target account', () => {
        setCallerSecretKey(OWNER_SK);
        expect(() => {
          runCircuit(contract.circuits.adminReallocate, OWNER, ALICE, zeroKey(), 0n);
        }).toThrow('FungibleToken: invalid receiver');
      });
    });

    describe('emergencyWithdraw', () => {
      const dummyTokenAddress = { bytes: createKey(77) };

      it('should reject emergencyWithdraw when contract is not paused', () => {
        setCallerSecretKey(OWNER_SK);
        expect(() => {
          runCircuit(contract.circuits.emergencyWithdraw, OWNER, dummyTokenAddress, 0n);
        }).toThrow('FungibleToken: contract is not paused');
      });

      it('should reject emergencyWithdraw when called by non-owner', () => {
        setCallerSecretKey(OWNER_SK);
        runCircuit(contract.circuits.pause, OWNER);

        setCallerSecretKey(ALICE_SK);
        expect(() => {
          runCircuit(contract.circuits.emergencyWithdraw, ALICE, dummyTokenAddress, 0n);
        }).toThrow('FungibleToken: only owner can call this');
      });

      it('should succeed with zero amount when called by owner while paused', () => {
        setCallerSecretKey(OWNER_SK);
        runCircuit(contract.circuits.pause, OWNER);

        const res = runCircuit(contract.circuits.emergencyWithdraw, OWNER, dummyTokenAddress, 0n);
        expect(res).toBe(true);
      });
    });
  });

  describe('Multi-Sig Governed Operations - Validation & Security', () => {
    describe('mint', () => {
      it('should reject mint when contract is paused', () => {
        setCallerSecretKey(OWNER_SK);
        runCircuit(contract.circuits.pause, OWNER);

        expect(() => {
          runCircuit(contract.circuits.mint, ALICE, 100n, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: contract is paused');
      });

      it('should reject mint with invalid receiver (zero key)', () => {
        expect(() => {
          runCircuit(contract.circuits.mint, zeroKey(), 100n, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should reject mint with duplicate signers', () => {
        expect(() => {
          runCircuit(contract.circuits.mint, ALICE, 100n, [dummyPoint1, dummyPoint1], [dummySig, dummySig]);
        }).toThrow('FungibleToken: duplicate signer detected');
      });

      it('should reject mint when signers are not registered in multisig signers set', () => {
        expect(() => {
          runCircuit(contract.circuits.mint, ALICE, 100n, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: signer not registered');
      });
    });

    describe('burn', () => {
      it('should reject multi-sig burn when contract is paused', () => {
        setCallerSecretKey(OWNER_SK);
        runCircuit(contract.circuits.pause, OWNER);

        expect(() => {
          runCircuit(contract.circuits.burn, OWNER, 100n, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: contract is paused');
      });

      it('should reject multi-sig burn with zero sender address', () => {
        expect(() => {
          runCircuit(contract.circuits.burn, zeroKey(), 100n, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: invalid sender');
      });

      it('should prevent arbitrary confiscation by rejecting multi-sig burn of non-owner account', () => {
        expect(() => {
          runCircuit(contract.circuits.burn, ALICE, 100n, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: multi-sig burn restricted to owner/treasury account');
      });

      it('should reject multi-sig burn with duplicate signers', () => {
        expect(() => {
          runCircuit(contract.circuits.burn, OWNER, 100n, [dummyPoint1, dummyPoint1], [dummySig, dummySig]);
        }).toThrow('FungibleToken: duplicate signer detected');
      });

      it('should reject multi-sig burn when signers are not registered', () => {
        expect(() => {
          runCircuit(contract.circuits.burn, OWNER, 100n, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: signer not registered');
      });
    });

    describe('setEmergencyPauser', () => {
      it('should reject setEmergencyPauser with zero pauser address', () => {
        expect(() => {
          runCircuit(contract.circuits.setEmergencyPauser, zeroKey(), [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: invalid pauser address');
      });

      it('should reject setEmergencyPauser with duplicate signers', () => {
        expect(() => {
          runCircuit(contract.circuits.setEmergencyPauser, PAUSER, [dummyPoint1, dummyPoint1], [dummySig, dummySig]);
        }).toThrow('FungibleToken: duplicate signer detected');
      });

      it('should reject setEmergencyPauser when signers are not registered', () => {
        expect(() => {
          runCircuit(contract.circuits.setEmergencyPauser, PAUSER, [dummyPoint1, dummyPoint2], [dummySig, dummySig]);
        }).toThrow('FungibleToken: signer not registered');
      });
    });
  });
});