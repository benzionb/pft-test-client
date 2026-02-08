import { pinToIPFSWeb3Storage } from "./ipfs.js";
import { buildPointerTransaction } from "./transaction.js";
import { TransactionSigner } from "./signer.js";

export class PFTClientError extends Error {}

export class PFTClient {
  signer: TransactionSigner;

  constructor(walletSeed: string, nodeUrl = "wss://ws.testnet.postfiat.org") {
    this.signer = new TransactionSigner({ seed: walletSeed, nodeUrl });
  }

  async pinToIPFS(payload: Uint8Array, apiToken: string) {
    return pinToIPFSWeb3Storage(payload, apiToken);
  }

  buildPointerTransaction(
    account: string,
    cid: string,
    kind = "TASK_SUBMISSION",
    schema = 1,
    flags = 1
  ) {
    return buildPointerTransaction(account, cid, kind, undefined, schema, flags);
  }

  async pinAndSubmit(payload: Uint8Array, apiToken: string) {
    try {
      const { cid } = await this.pinToIPFS(payload, apiToken);
      const tx = this.buildPointerTransaction(this.signer.wallet.classicAddress, cid);
      const txHash = await this.signer.signAndSubmit(tx as any);
      return { cid, txHash };
    } catch (err) {
      throw new PFTClientError(String(err));
    }
  }
}
