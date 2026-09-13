import * as fs from 'node:fs';
import * as path from 'node:path';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { createUnprovenDeployTxFromVerifierKeys } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { pathToFileURL } from 'node:url';
import { LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { u8aToHex } from '@polkadot/util';

async function main() {
  setNetworkId('preprod');
  const contractType = 'fungible-token-v2-2';
  const zkConfigPath = path.resolve('contracts', 'managed', contractType);
  const contractJsPath = path.join(zkConfigPath, 'contract', 'index.js');
  const mod = await import(pathToFileURL(contractJsPath).href);
  const ContractClass = mod.Contract;

  const zkConfigProvider = {
    getVerifierKey: async (id) => {
      const p = path.join(zkConfigPath, 'keys', id + '.verifier');
      return fs.promises.readFile(p);
    }
  };

  const compiledContract = CompiledContract.make(contractType, ContractClass).pipe(
    CompiledContract.withWitnesses({ localSecretKey: () => new Uint8Array(32) }),
    CompiledContract.withCompiledFileAssets(zkConfigPath)
  );

  const coinPk = '00'.repeat(32);
  const encPk = '00'.repeat(32);

  const result = await createUnprovenDeployTxFromVerifierKeys(
    zkConfigProvider,
    coinPk,
    {
      compiledContract,
      args: [new Uint8Array(32), new Uint8Array(32), 'Token', 'TKN', 18n, 1000n]
    },
    encPk
  );

  const tx = result.private.unprovenTx;
  const serialized = tx.serialize();
  console.log('Unproven TX serialized bytes length:', serialized.length);

  const provider = new WsProvider('wss://rpc.preprod.midnight.network');
  const api = await ApiPromise.create({ provider });

  const ext = api.tx.midnight.sendMnTransaction(u8aToHex(serialized));
  console.log('Extrinsic encoded length:', ext.encodedLength);

  try {
    const dummyAlice = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
    const info = await ext.paymentInfo(dummyAlice);
    console.log('Payment info:', JSON.stringify(info.toJSON(), null, 2));
  } catch (err) {
    console.error('paymentInfo error:', err);
  }

  await api.disconnect();
}

main().catch(console.error);
