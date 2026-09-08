/**
 * Domain Entities: Contract Registry & Dynamic Blueprint Descriptors
 */

export interface CircuitParamDescriptor {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'address';
    compactType?: string;
    label: string;
    description?: string;
    placeholder?: string;
    defaultValue?: any;
    required?: boolean;
}

export interface CircuitDescriptor {
    name: string;
    displayName: string;
    description: string;
    params: CircuitParamDescriptor[];
}

export interface StateFieldDescriptor {
    name: string;
    displayName: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    description?: string;
}

export interface ContractBlueprint {
    id: string; // e.g. 'hello-world'
    name: string; // e.g. 'Hello World Message Board'
    description: string;
    category: 'Messaging' | 'Token' | 'Governance' | 'Utility';
    version: string;
    constructorParams?: CircuitParamDescriptor[];
    circuits: CircuitDescriptor[];
    stateFields: StateFieldDescriptor[];
}

export interface DeployedContractRecord {
    contractAddress: string;
    contractType: string; // matches ContractBlueprint.id
    nickname?: string;
    deployerSeed?: string;
    seed?: string;
    network?: string;
    deployedAt: string;
    owner?: string;
}
