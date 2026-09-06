import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token/contract/index.js';

type PrivateState = Record<string, never>;

describe('FungibleToken Contract Tests', () => {
  const dummyContractAddress = '00'.repeat(32);
  const dummyCoinPublicKey = '01'.repeat(32);

  const createKey = (byteValue: number): Uint8Array => new Uint8Array(32).fill(byteValue);

  const ZERO_KEY = new Uint8Array(32); // default / 0x00...00
  const ALICE = createKey(1);
  const BOB = createKey(2);
  const CHARLIE = createKey(3);

  const MAX_UINT128 = (1n << 128n) - 1n; // 340282366920938463463374607431768211455n

  const TOKEN_NAME = 'Midnight Token';
  const TOKEN_SYMBOL = 'MDT';
  const TOKEN_DECIMALS = 18n;

  let contract: Contract<PrivateState>;
  let privateState: PrivateState;
  let circuitContext: CompactRuntime.CircuitContext<PrivateState>;

  const runCircuit = (circuitFn: (...args: any[]) => any, ...args: any[]) => {
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

  const getLedgerState = () => {
    return ledger(circuitContext.currentQueryContext.state);
  };

  beforeEach(() => {
    const witnesses: Witnesses<PrivateState> = {};
    contract = new Contract(witnesses);
    privateState = {};

    const constructorCtx = CompactRuntime.createConstructorContext(privateState, dummyCoinPublicKey);
    const { currentContractState, currentPrivateState } = contract.initialState(constructorCtx, ALICE);

    privateState = currentPrivateState;
    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      currentContractState.data,
      privateState
    );

    // Initialize the token
    runCircuit(contract.circuits.initialize, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS);
  });

  describe('Initialization & Metadata', () => {
    it('should return correct token metadata', () => {
      const name = runCircuit(contract.circuits.name);
      const symbol = runCircuit(contract.circuits.symbol);
      const decimals = runCircuit(contract.circuits.decimals);
      const totalSupply = runCircuit(contract.circuits.totalSupply);

      expect(name).toBe(TOKEN_NAME);
      expect(symbol).toBe(TOKEN_SYMBOL);
      expect(decimals).toBe(TOKEN_DECIMALS);
      expect(totalSupply).toBe(0n);
    });
  });

  describe('Minting (_mint)', () => {
    it('should mint tokens to an account and update total supply', () => {
      const mintAmount = 1_000n;
      runCircuit(contract.circuits._mint, ALICE, mintAmount);

      const aliceBalance = runCircuit(contract.circuits.balanceOf, ALICE);
      const totalSupply = runCircuit(contract.circuits.totalSupply);

      expect(aliceBalance).toBe(mintAmount);
      expect(totalSupply).toBe(mintAmount);
    });

    it('should fail when minting to the zero address', () => {
      expect(() => {
        runCircuit(contract.circuits._mint, ZERO_KEY, 500n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail on mint arithmetic overflow', () => {
      runCircuit(contract.circuits._mint, ALICE, MAX_UINT128);

      expect(() => {
        runCircuit(contract.circuits._mint, BOB, 1n);
      }).toThrow('FungibleToken: arithmetic overflow');
    });
  });

  describe('Burning (_burn)', () => {
    const initialSupply = 1_000n;

    beforeEach(() => {
      runCircuit(contract.circuits._mint, ALICE, initialSupply);
    });

    it('should burn tokens from an account and decrease total supply', () => {
      const burnAmount = 400n;
      runCircuit(contract.circuits._burn, ALICE, burnAmount);

      const aliceBalance = runCircuit(contract.circuits.balanceOf, ALICE);
      const totalSupply = runCircuit(contract.circuits.totalSupply);

      expect(aliceBalance).toBe(600n);
      expect(totalSupply).toBe(600n);
    });

    it('should fail when burning from the zero address', () => {
      expect(() => {
        runCircuit(contract.circuits._burn, ZERO_KEY, 100n);
      }).toThrow('FungibleToken: invalid sender');
    });

    it('should fail when burning more than balance', () => {
      expect(() => {
        runCircuit(contract.circuits._burn, ALICE, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });
  });

  describe('Transfers (transfer & _transfer)', () => {
    const initialBalance = 1_000n;

    beforeEach(() => {
      runCircuit(contract.circuits._mint, ALICE, initialBalance);
    });

    it('should transfer tokens between accounts successfully', () => {
      const transferAmount = 300n;
      const res = runCircuit(contract.circuits.transfer, ALICE, BOB, transferAmount);

      expect(res).toBe(true);

      const aliceBal = runCircuit(contract.circuits.balanceOf, ALICE);
      const bobBal = runCircuit(contract.circuits.balanceOf, BOB);
      const totalSupply = runCircuit(contract.circuits.totalSupply);

      expect(aliceBal).toBe(700n);
      expect(bobBal).toBe(300n);
      expect(totalSupply).toBe(initialBalance);
    });

    it('should allow transferring 0 tokens', () => {
      const res = runCircuit(contract.circuits.transfer, ALICE, BOB, 0n);
      expect(res).toBe(true);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(initialBalance);
      expect(runCircuit(contract.circuits.balanceOf, BOB)).toBe(0n);
    });

    it('should fail when transfer amount exceeds balance', () => {
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, BOB, 1_001n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should fail when transferring to zero address', () => {
      expect(() => {
        runCircuit(contract.circuits.transfer, ALICE, ZERO_KEY, 100n);
      }).toThrow('FungibleToken: invalid receiver');
    });

    it('should fail when transferring from zero address via _transfer', () => {
      expect(() => {
        runCircuit(contract.circuits._transfer, ZERO_KEY, BOB, 100n);
      }).toThrow('FungibleToken: invalid sender');
    });
  });

  describe('Approvals & Allowances (approve & allowance)', () => {
    it('should return zero allowance by default', () => {
      const initialAllowance = runCircuit(contract.circuits.allowance, ALICE, BOB);
      expect(initialAllowance).toBe(0n);
    });

    it('should approve an allowance successfully', () => {
      const allowanceAmount = 500n;
      const res = runCircuit(contract.circuits.approve, ALICE, BOB, allowanceAmount);

      expect(res).toBe(true);
      const currentAllowance = runCircuit(contract.circuits.allowance, ALICE, BOB);
      expect(currentAllowance).toBe(allowanceAmount);
    });

    it('should fail when approving with zero owner address', () => {
      expect(() => {
        runCircuit(contract.circuits._approve, ZERO_KEY, BOB, 500n);
      }).toThrow('FungibleToken: invalid owner');
    });

    it('should fail when approving zero spender address', () => {
      expect(() => {
        runCircuit(contract.circuits.approve, ALICE, ZERO_KEY, 500n);
      }).toThrow('FungibleToken: invalid spender');
    });
  });

  describe('TransferFrom & Spend Allowance', () => {
    const initialBalance = 1_000n;
    const allowanceAmount = 500n;

    beforeEach(() => {
      runCircuit(contract.circuits._mint, ALICE, initialBalance);
      runCircuit(contract.circuits.approve, ALICE, BOB, allowanceAmount);
    });

    it('should transfer tokens via transferFrom and reduce allowance', () => {
      const transferAmount = 200n;
      const res = runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, transferAmount);

      expect(res).toBe(true);
      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(800n);
      expect(runCircuit(contract.circuits.balanceOf, CHARLIE)).toBe(200n);
      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(300n);
    });

    it('should fail when transferFrom exceeds allowance', () => {
      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 501n);
      }).toThrow('FungibleToken: insufficient allowance');
    });

    it('should fail when transferFrom exceeds owner balance even if allowance is sufficient', () => {
      runCircuit(contract.circuits.approve, ALICE, BOB, 2_000n);

      expect(() => {
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, 1_500n);
      }).toThrow('FungibleToken: insufficient balance');
    });

    it('should not reduce allowance when allowance is MAX_UINT128 (infinite allowance)', () => {
      runCircuit(contract.circuits.approve, ALICE, BOB, MAX_UINT128);

      const transferAmount = 100n;
      runCircuit(contract.circuits.transferFrom, BOB, ALICE, CHARLIE, transferAmount);

      expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(900n);
      expect(runCircuit(contract.circuits.balanceOf, CHARLIE)).toBe(100n);
      expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(MAX_UINT128);
    });

    it('should fail when spending allowance for unapproved account', () => {
      expect(() => {
        runCircuit(contract.circuits._spendAllowance, ALICE, CHARLIE, 50n);
      }).toThrow('FungibleToken: insufficient allowance');
    });
  });
});