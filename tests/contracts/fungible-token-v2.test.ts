import { describe, it, expect, beforeEach } from 'vitest';
import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Witnesses } from '../../contracts/managed/fungible-token-v2/contract/index.js';

type PrivateState = Record<string, never>;

describe('FungibleTokenV2 Contract', () => {
  const dummyContractAddress = '00'.repeat(32);
  const dummyCoinPublicKey = '01'.repeat(32);

  const createKey = (b: number): Uint8Array => new Uint8Array(32).fill(b);

  const OWNER = createKey(1);
  const ALICE = createKey(2);
  const BOB = createKey(3);
  const ZERO_KEY = createKey(0);

  const MAX_UINT128 = (1n << 128n) - 1n;

  const TOKEN_NAME = 'Midnight Token';
  const TOKEN_SYMBOL = 'MDT';
  const TOKEN_DECIMALS = 18n;

  let contract: Contract<PrivateState>;
  let privateState: PrivateState;
  let circuitContext: any;

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
    const { currentContractState, currentPrivateState } = contract.initialState(constructorCtx, OWNER);
    privateState = currentPrivateState;

    circuitContext = CompactRuntime.createCircuitContext(
      dummyContractAddress,
      dummyCoinPublicKey,
      currentContractState.data,
      privateState
    );
  });

  describe('Uninitialized State', () => {
    it('should reject view circuits before initialization', () => {
      expect(() => runCircuit(contract.circuits.name)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.symbol)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.decimals)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.totalSupply)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.balanceOf, OWNER)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.allowance, OWNER, ALICE)).toThrow('FungibleToken: contract not initialized');
    });

    it('should reject state-changing circuits before initialization', () => {
      expect(() => runCircuit(contract.circuits.transfer, OWNER, ALICE, 100n)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.approve, OWNER, ALICE, 100n)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.transferFrom, ALICE, OWNER, BOB, 100n)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.mint, OWNER, ALICE, 100n)).toThrow('FungibleToken: contract not initialized');
      expect(() => runCircuit(contract.circuits.burn, OWNER, 100n)).toThrow('FungibleToken: contract not initialized');
    });
  });

  describe('Initialization', () => {
    it('should correctly initialize token metadata', () => {
      runCircuit(contract.circuits.initialize, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS);

      const name = runCircuit(contract.circuits.name);
      const symbol = runCircuit(contract.circuits.symbol);
      const decimals = runCircuit(contract.circuits.decimals);
      const totalSupply = runCircuit(contract.circuits.totalSupply);

      expect(name).toBe(TOKEN_NAME);
      expect(symbol).toBe(TOKEN_SYMBOL);
      expect(Number(decimals)).toBe(18);
      expect(totalSupply).toBe(0n);

      const state = getLedgerState();
      expect(state._isInitialized).toBe(true);
      expect(state.owner).toEqual(OWNER);
    });

    it('should fail if initialized more than once', () => {
      runCircuit(contract.circuits.initialize, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS);

      expect(() => {
        runCircuit(contract.circuits.initialize, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS);
      }).toThrow('FungibleToken: contract already initialized');
    });
  });

  describe('When Initialized', () => {
    beforeEach(() => {
      runCircuit(contract.circuits.initialize, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS);
    });

    describe('Minting', () => {
      it('should allow the owner to mint tokens', () => {
        const amount = 1_000n;
        const success = runCircuit(contract.circuits.mint, OWNER, ALICE, amount);

        expect(success).toBe(true);
        expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(amount);
        expect(runCircuit(contract.circuits.totalSupply)).toBe(amount);
      });

      it('should fail when non-owner attempts to mint', () => {
        expect(() => {
          runCircuit(contract.circuits.mint, ALICE, ALICE, 1_000n);
        }).toThrow('FungibleToken: caller is not the owner');
      });

      it('should fail when minting to the zero address', () => {
        expect(() => {
          runCircuit(contract.circuits.mint, OWNER, ZERO_KEY, 1_000n);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should fail when minting exceeds maximum Uint128 value', () => {
        runCircuit(contract.circuits.mint, OWNER, ALICE, MAX_UINT128);

        expect(() => {
          runCircuit(contract.circuits.mint, OWNER, ALICE, 1n);
        }).toThrow('FungibleToken: arithmetic overflow');
      });
    });

    describe('Transfers', () => {
      const initialBalance = 1_000n;

      beforeEach(() => {
        runCircuit(contract.circuits.mint, OWNER, ALICE, initialBalance);
      });

      it('should transfer tokens between accounts', () => {
        const transferAmount = 400n;
        const success = runCircuit(contract.circuits.transfer, ALICE, BOB, transferAmount);

        expect(success).toBe(true);
        expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(600n);
        expect(runCircuit(contract.circuits.balanceOf, BOB)).toBe(400n);
        expect(runCircuit(contract.circuits.totalSupply)).toBe(initialBalance);
      });

      it('should allow transferring 0 tokens', () => {
        const success = runCircuit(contract.circuits.transfer, ALICE, BOB, 0n);

        expect(success).toBe(true);
        expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(initialBalance);
        expect(runCircuit(contract.circuits.balanceOf, BOB)).toBe(0n);
      });

      it('should fail when sender has insufficient balance', () => {
        expect(() => {
          runCircuit(contract.circuits.transfer, ALICE, BOB, initialBalance + 1n);
        }).toThrow('FungibleToken: insufficient balance');
      });

      it('should fail when sender is zero address', () => {
        expect(() => {
          runCircuit(contract.circuits.transfer, ZERO_KEY, BOB, 100n);
        }).toThrow('FungibleToken: invalid sender');
      });

      it('should fail when receiver is zero address', () => {
        expect(() => {
          runCircuit(contract.circuits.transfer, ALICE, ZERO_KEY, 100n);
        }).toThrow('FungibleToken: invalid receiver');
      });
    });

    describe('Approvals and Allowances', () => {
      it('should approve spender and return updated allowance', () => {
        const allowanceAmount = 500n;
        const success = runCircuit(contract.circuits.approve, ALICE, BOB, allowanceAmount);

        expect(success).toBe(true);
        expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(allowanceAmount);
      });

      it('should return 0 allowance for unset spender', () => {
        expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(0n);
      });

      it('should fail to approve from zero address owner', () => {
        expect(() => {
          runCircuit(contract.circuits.approve, ZERO_KEY, BOB, 500n);
        }).toThrow('FungibleToken: invalid owner');
      });

      it('should fail to approve to zero address spender', () => {
        expect(() => {
          runCircuit(contract.circuits.approve, ALICE, ZERO_KEY, 500n);
        }).toThrow('FungibleToken: invalid spender');
      });
    });

    describe('TransferFrom', () => {
      const mintedAmount = 1_000n;
      const approvedAmount = 600n;

      beforeEach(() => {
        runCircuit(contract.circuits.mint, OWNER, ALICE, mintedAmount);
        runCircuit(contract.circuits.approve, ALICE, BOB, approvedAmount);
      });

      it('should transfer tokens via transferFrom and reduce allowance', () => {
        const transferAmount = 400n;
        const success = runCircuit(contract.circuits.transferFrom, BOB, ALICE, OWNER, transferAmount);

        expect(success).toBe(true);
        expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(mintedAmount - transferAmount);
        expect(runCircuit(contract.circuits.balanceOf, OWNER)).toBe(transferAmount);
        expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(approvedAmount - transferAmount);
      });

      it('should not reduce allowance if approved amount is MAX_UINT128', () => {
        runCircuit(contract.circuits.approve, ALICE, BOB, MAX_UINT128);

        const transferAmount = 300n;
        runCircuit(contract.circuits.transferFrom, BOB, ALICE, OWNER, transferAmount);

        expect(runCircuit(contract.circuits.balanceOf, ALICE)).toBe(mintedAmount - transferAmount);
        expect(runCircuit(contract.circuits.allowance, ALICE, BOB)).toBe(MAX_UINT128);
      });

      it('should fail transferFrom when spending more than allowance', () => {
        expect(() => {
          runCircuit(contract.circuits.transferFrom, BOB, ALICE, OWNER, approvedAmount + 1n);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail transferFrom when spender has no allowance', () => {
        const UNAUTHORIZED = createKey(4);
        expect(() => {
          runCircuit(contract.circuits.transferFrom, UNAUTHORIZED, ALICE, OWNER, 100n);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail transferFrom when token owner has insufficient balance', () => {
        runCircuit(contract.circuits.approve, ALICE, BOB, 5_000n);

        expect(() => {
          runCircuit(contract.circuits.transferFrom, BOB, ALICE, OWNER, 2_000n);
        }).toThrow('FungibleToken: insufficient balance');
      });
    });

    describe('Burning', () => {
      const mintedAmount = 1_000n;

      beforeEach(() => {
        runCircuit(contract.circuits.mint, OWNER, OWNER, mintedAmount);
      });

      it('should allow owner to burn own tokens', () => {
        const burnAmount = 300n;
        const success = runCircuit(contract.circuits.burn, OWNER, burnAmount);

        expect(success).toBe(true);
        expect(runCircuit(contract.circuits.balanceOf, OWNER)).toBe(700n);
        expect(runCircuit(contract.circuits.totalSupply)).toBe(700n);
      });

      it('should fail when non-owner attempts to burn', () => {
        expect(() => {
          runCircuit(contract.circuits.burn, ALICE, 100n);
        }).toThrow('FungibleToken: caller is not the owner');
      });

      it('should fail when owner burns more than balance', () => {
        expect(() => {
          runCircuit(contract.circuits.burn, OWNER, mintedAmount + 1n);
        }).toThrow('FungibleToken: insufficient balance');
      });
    });
  });
});