/**
 * Composition Root / Dependency Injection Container
 * Assembles domain gateways, adapters, and use cases into singletons for application consumption.
 */

import { createStorageServices } from '../persistence/storage.factory';
import { MidnightWalletAdapter } from '../midnight/midnight-wallet.adapter';
import { MidnightContractAdapter } from '../midnight/midnight-contract.adapter';
import { MidnightSystemAdapter } from '../midnight/midnight-system.adapter';

import { MidnightBulletinBoardAdapter } from '../midnight/midnight-bulletin-board.adapter';

import { GetWalletStatusUseCase } from '@/src/application/use-cases/get-wallet-status.usecase';
import { RegisterDustUseCase } from '@/src/application/use-cases/register-dust.usecase';
import { StoreMessageUseCase } from '@/src/application/use-cases/store-message.usecase';
import { DeployContractUseCase } from '@/src/application/use-cases/deploy-contract.usecase';
import { GetContractStateUseCase } from '@/src/application/use-cases/get-contract-state.usecase';
import { SendUnshieldedTNightUseCase } from '@/src/application/use-cases/send-unshielded-tnight.usecase';
import { GetSystemHealthUseCase } from '@/src/application/use-cases/get-system-health.usecase';
import { DeriveKeysUseCase } from '@/src/application/use-cases/derive-keys.usecase';
import { GetBulletinBoardStateUseCase } from '@/src/application/use-cases/get-bulletin-board-state.usecase';
import { ResetBulletinBoardStateUseCase } from '@/src/application/use-cases/reset-bulletin-board-state.usecase';
import { RunBulletinBoardShowcaseUseCase } from '@/src/application/use-cases/run-bulletin-board-showcase.usecase';
import { ExecuteBulletinBoardCircuitUseCase } from '@/src/application/use-cases/execute-bulletin-board-circuit.usecase';
import { ResetWalletSyncUseCase } from '@/src/application/use-cases/reset-wallet-sync.usecase';

const storage = createStorageServices();

class Container {
    // Persistence
    public readonly deploymentStorage = storage.deploymentStorage;
    public readonly txHistoryStorage = storage.txHistoryStorage;
    public readonly walletStateStorage = storage.walletStateStorage;
    public readonly activeStorageDriver = storage.activeDriver;

    // Adapters / Gateways
    public readonly walletGateway = new MidnightWalletAdapter(this.txHistoryStorage as any, this.walletStateStorage);
    public readonly contractGateway = new MidnightContractAdapter(this.walletGateway, this.deploymentStorage, this.txHistoryStorage as any);
    public readonly systemGateway = new MidnightSystemAdapter(this.deploymentStorage);
    public readonly bulletinBoardGateway = new MidnightBulletinBoardAdapter();

    // Use Cases
    public readonly getWalletStatusUseCase = new GetWalletStatusUseCase(this.walletGateway);
    public readonly registerDustUseCase = new RegisterDustUseCase(this.walletGateway);
    public readonly storeMessageUseCase = new StoreMessageUseCase(this.contractGateway);
    public readonly deployContractUseCase = new DeployContractUseCase(this.contractGateway);
    public readonly getContractStateUseCase = new GetContractStateUseCase(this.contractGateway);
    public readonly sendUnshieldedTNightUseCase = new SendUnshieldedTNightUseCase(this.walletGateway);
    public readonly resetWalletSyncUseCase = new ResetWalletSyncUseCase(this.walletGateway);
    public readonly getSystemHealthUseCase = new GetSystemHealthUseCase(this.systemGateway);
    public readonly deriveKeysUseCase = new DeriveKeysUseCase(this.walletGateway);

    // Bulletin Board Use Cases
    public readonly getBulletinBoardStateUseCase = new GetBulletinBoardStateUseCase(this.bulletinBoardGateway);
    public readonly resetBulletinBoardStateUseCase = new ResetBulletinBoardStateUseCase(this.bulletinBoardGateway);
    public readonly runBulletinBoardShowcaseUseCase = new RunBulletinBoardShowcaseUseCase(this.bulletinBoardGateway);
    public readonly executeBulletinBoardCircuitUseCase = new ExecuteBulletinBoardCircuitUseCase(this.bulletinBoardGateway);
}

// Export singleton instance
export const container = new Container();
