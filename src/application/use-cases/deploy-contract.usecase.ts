import type { IContractGateway } from '@/src/domain/ports/i-contract.gateway';
import type { DeployContractInput, DeployContractOutput } from '../dto/use-case-dtos';

export class DeployContractUseCase {
    constructor(private readonly contractGateway: IContractGateway) {}

    async execute(input: DeployContractInput): Promise<DeployContractOutput> {
        return this.contractGateway.deployContract(input.seed, {
            contractType: input.contractType,
            privateStatePassword: input.privateStatePassword,
            constructorArgs: input.constructorArgs,
        });
    }
}
