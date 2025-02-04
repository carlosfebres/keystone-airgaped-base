import { InteractionProvider } from '@keystonehq/base-eth-keyring';
import { EventEmitter } from 'events';
import { ObservableStore } from '@metamask/obs-store';
import { EthSignRequest, ETHSignature, CryptoHDKey } from '@keystonehq/bc-ur-registry-eth';
import * as uuid from 'uuid';

export class MetamaskInteractionProvider extends EventEmitter implements InteractionProvider {
    static instance: MetamaskInteractionProvider;
    public memStore: ObservableStore<{
        _version: number;
        sync: {
            reading: boolean;
        };
        sign: {
            request?: {
                requestId: string;
                payload: {
                    type: string;
                    cbor: string;
                };
                title?: string;
                description?: string;
            };
        };
    }>;
    constructor() {
        super();
        if (MetamaskInteractionProvider.instance) {
            return MetamaskInteractionProvider.instance;
        }
        this.memStore = new ObservableStore({ sync: { reading: false }, sign: {}, _version: 1 });
        MetamaskInteractionProvider.instance = this;
    }
    readCryptoHDKey = (): Promise<CryptoHDKey> => {
        return new Promise((resolve, reject) => {
            this.memStore.updateState({
                sync: { reading: true },
            });
            this.on('keystone-sync_success', (cbor: string) => {
                const cryptoHDKey = CryptoHDKey.fromCBOR(Buffer.from(cbor, 'hex'));
                this.resetState();
                resolve(cryptoHDKey);
            });
            this.on('keystone-sync_cancel', () => {
                this.resetState();
                reject(new Error('KeystoneError#sync_cancel. Sync process canceled, please retry'));
            });
        });
    };

    submitCryptoHDKey = (cbor: string) => {
        this.emit('keystone-sync_success', cbor);
    };

    cancelReadCryptoHDKey = () => {
        this.emit('keystone-sync_cancel');
    };

    requestSignature = (
        signRequest: EthSignRequest,
        requestTitle?: string,
        requestDescription?: string,
    ): Promise<ETHSignature> => {
        return new Promise((resolve, reject) => {
            const ur = signRequest.toUR();
            const requestIdBuffer = signRequest.getRequestId();
            const requestId = uuid.stringify(requestIdBuffer);
            const signPayload = {
                requestId,
                payload: {
                    type: ur.type,
                    cbor: ur.cbor.toString('hex'),
                },
                title: requestTitle,
                description: requestDescription,
            };
            this.memStore.updateState({
                sign: {
                    request: signPayload,
                },
            });

            this.once(`${requestId}-signed`, (cbor: string) => {
                const ethSignature = ETHSignature.fromCBOR(Buffer.from(cbor, 'hex'));
                this.resetState();
                resolve(ethSignature);
            });
            this.once(`${requestId}-canceled`, () => {
                this.resetState();
                reject(new Error('KeystoneError#Tx_canceled. Signing canceled, please retry'));
            });
        });
    };

    submitSignature = (requestId: string, cbor: string) => {
        this.emit(`${requestId}-signed`, cbor);
    };

    cancelRequestSignature = () => {
        const signPayload = this.memStore.getState().sign.request;
        if (signPayload) {
            const { requestId } = signPayload;
            this.memStore.updateState({ sign: {} });
            this.emit(`${requestId}-canceled`);
        }
    };

    private resetState = () => {
        this.memStore.updateState({
            sync: {
                reading: false,
            },
            sign: {},
        });
    };
}
