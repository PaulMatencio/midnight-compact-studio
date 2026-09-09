import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2-2/contract/index.js';

type PrivateState = {
  currentSecretKey: Uint8Array;
};

describe('FungibleToken (fungible-token-v2-2)', () => {
  const MAX_UINT128 = 340282366920938463463374607431768211455n;
  const dummyContractAddress = '00'.repeat(32);
  const dummyCoinPublicKey = '01'.repeat(32);
  const dummyAddressBytes = Uint8Array.from(Buffer.from(dummyContractAddress, 'hex'));

  // Domain tag padded to 32 bytes for authentication hash derivation
  const domainTag = new Uint8Array(32);
  domainTag.set(new TextEncoder().encode('fungible-token:auth'));

  const createKey = (byteVal: number): Uint8Array => new Uint8Array(32).fill(byteVal);
  const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);

  // Secret keys for distinct test actors
  const OWNER_SK = createKey(1);
  const ALICE_SK = createKey(2);
  const BOB_SK = createKey(3);
  const CHARLIE_SK = createKey(4);

  let privateState: PrivateState;
  let contract: Contract<PrivateState>;
  let circuitContext: any;
  let ownerAccount: Uint8Array;
  let aliceAccount: Uint8Array;
  let bobAccount: Uint8Array;
  let charlieAccount: Uint8Array;

  // Helper to derive public account addresses matching the contract's persistentHash
  const deriveAccount = (sk: Uint8Array): Uint8Array => {
    const helperContract = new Contract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
    });
    const proto = Object.getPrototypeOf(helperContract);
    const propNames = [...Object.getOwnPropertyNames(proto), ...Object.getOwnPropertyNames(helperContract)];
    const phMethod = propNames.find((m) => m.startsWith('_persistentHash') || m.includes('persistentHash'));
    if (phMethod && typeof (helperContract as any)[phMethod] === 'function') {
      return (helperContract as any)[phMethod]([domainTag, { bytes: dummyAddressBytes }, sk]);
    }
    return (helperContract as any)._persistentHash_0([domainTag, { bytes: dummyAddressBytes }, sk]);
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

  const deployContract = (
    maxSupply: bigint = 1_000_000n,
    name: string = 'Midnight Token',
    symbol: string = 'MDT',
    decimals: bigint = 8n
  ) => {
    privateState = { currentSecretKey: OWNER_SK };
    const witnesses: Witnesses<PrivateState> = {
      localSecretKey: ({ privateState }: any) => [privateState, privateState.currentSecretKey],
    };

    contract = new Contract(witnesses);

    let constructorCtx: any;
    try {
      constructorCtx = (CompactRuntime as any).createConstructorContext(
        dummyContractAddress,
        dummyCoinPublicKey,
        privateState
      );
    } catch {
      constructorCtx = (CompactRuntime as any).createConstructorContext(privateState, dummyCoinPublicKey);
    }

    const { currentContractState } = contract.initialState(
      constructorCtx,
      ownerAccount,
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
    ownerAccount = deriveAccount(OWNER_SK);
    aliceAccount = deriveAccount(ALICE_SK);
    bobAccount = deriveAccount(BOB_SK);
    charlieAccount = deriveAccount(CHARLIE_SK);

    deployContract(1_000_000n, 'Midnight Token', 'MDT', 8n);
  });

  describe('Initialization & Metadata', () => {
    it('should initialize contract with correct metadata', () => {
      expect(runCircuit(contract.circuits.name)).toBe('Midnight Token');
      expect(runCircuit(contract.circuits.symbol)).toBe('MDT');
      expect(Number(runCircuit(contract.circuits.decimals))).toBe(8);
      expect(runCircuit(contract.circuits.maxSupply)).toBe(1_000_000n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(0n);
    });

    it('should default maxSupply to MAX_UINT128 when initialized with 0', () => {
      deployContract(0n, 'Unlimited Token', 'ULT', 18n);
      expect(runCircuit(contract.circuits.maxSupply)).toBe(MAX_UINT128);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(0n);
    });

    it('should report zero balance for uninitialized accounts', () => {
      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(0n);
      expect(runCircuit(contract.circuits.balanceOf, bobAccount)).toBe(0n);
    });

    it('should report zero allowance by default', () => {
      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(0n);
    });
  });

  describe('Authentication & Access Control', () => {
    it('should fail when caller secret key does not match caller account', () => {
      setCallerSecretKey(BOB_SK); // Bob holds BOB_SK
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 50n);
      }).toThrow('FungibleToken: caller authorization failed');
    });

    it('should fail when unauthorized caller attempts to mint', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, aliceAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('Minting', () => {
    it('should allow owner to mint tokens to an account', () => {
      setCallerSecretKey(OWNER_SK);
      const success = runCircuit(contract.circuits.mint, aliceAccount, 500n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(500n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(500n);
    });

    it('should fail when minting to zero key receiver', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, zeroKey(), 500n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail when minting exceeds maxSupply', () => {
      setCallerSecretKey(OWNER_SK);
      expect(() => {
        runCircuit(contract.circuits.mint, aliceAccount, 1_000_001n);
      }).toThrow('FungibleToken: supply overflow');
    });

    it('should support multiple consecutive mints up to maxSupply', () => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 600_000n);
      runCircuit(contract.circuits.mint, bobAccount, 400_000n);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(600_000n);
      expect(runCircuit(contract.circuits.balanceOf, bobAccount)).toBe(400_000n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(1_000_000n);

      expect(() => {
        runCircuit(contract.circuits.mint, aliceAccount, 1n);
      }).toThrow('FungibleToken: supply overflow');
    });
  });

  describe('Transfers', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 1_000n);
    });

    it('should allow account holder to transfer tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 300n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(700n);
      expect(runCircuit(contract.circuits.balanceOf, bobAccount)).toBe(300n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(1_000n);
    });

    it('should fail when transferring more than available balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail when transferring to zero key receiver', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, zeroKey(), 100n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should allow self-transfer if caller has sufficient balance', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.transfer, aliceAccount, aliceAccount, 500n);
      expect(success).toBe(true);
      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(1_000n);
    });

    it('should fail self-transfer if caller has insufficient balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.transfer, aliceAccount, aliceAccount, 2_000n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should allow transferring entire balance to reach zero', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.transfer, aliceAccount, bobAccount, 1_000n);
      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(0n);
      expect(runCircuit(contract.circuits.balanceOf, bobAccount)).toBe(1_000n);
    });
  });

  describe('Approvals & Allowances', () => {
    it('should allow owner to approve a spender allowance', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 400n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(400n);
    });

    it('should overwrite existing allowance when re-approved', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 400n);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 150n);

      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(150n);
    });

    it('should fail when approving zero key spender', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.approve, aliceAccount, zeroKey(), 500n);
      }).toThrow('FungibleToken: invalid spender');
    });
  });

  describe('transferFrom', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 1_000n);

      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 400n);
    });

    it('should allow spender to transfer within allowance', () => {
      setCallerSecretKey(BOB_SK);
      const success = runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 250n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(750n);
      expect(runCircuit(contract.circuits.balanceOf, charlieAccount)).toBe(250n);
      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(150n);
    });

    it('should fail when transferFrom exceeds allowance', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 401n);
      }).toThrow('FungibleToken: insufficient allowance');
    });

    it('should fail when transferFrom exceeds balance even if allowance is sufficient', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, 2_000n);

      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 1_500n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should not reduce allowance when set to MAX_UINT128 (infinite allowance)', () => {
      setCallerSecretKey(ALICE_SK);
      runCircuit(contract.circuits.approve, aliceAccount, bobAccount, MAX_UINT128);

      setCallerSecretKey(BOB_SK);
      runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 300n);

      expect(runCircuit(contract.circuits.allowance, aliceAccount, bobAccount)).toBe(MAX_UINT128);
      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(700n);
      expect(runCircuit(contract.circuits.balanceOf, charlieAccount)).toBe(300n);
    });

    it('should fail when caller authorization fails for transferFrom', () => {
      setCallerSecretKey(CHARLIE_SK); // Charlie tries to execute using Bob's allowance
      expect(() => {
        runCircuit(contract.circuits.transferFrom, bobAccount, aliceAccount, charlieAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });

  describe('Burning', () => {
    beforeEach(() => {
      setCallerSecretKey(OWNER_SK);
      runCircuit(contract.circuits.mint, aliceAccount, 1_000n);
    });

    it('should allow token holder to burn their own tokens', () => {
      setCallerSecretKey(ALICE_SK);
      const success = runCircuit(contract.circuits.burn, aliceAccount, 400n);
      expect(success).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, aliceAccount)).toBe(600n);
      expect(runCircuit(contract.circuits.totalSupply)).toBe(600n);
    });

    it('should fail when burning more than balance', () => {
      setCallerSecretKey(ALICE_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, aliceAccount, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail when burning with unauthorized caller key', () => {
      setCallerSecretKey(BOB_SK);
      expect(() => {
        runCircuit(contract.circuits.burn, aliceAccount, 100n);
      }).toThrow('FungibleToken: caller authorization failed');
    });
  });
});