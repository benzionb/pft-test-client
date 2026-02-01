import { Client, Wallet, xrpToDrops, Payment } from "xrpl";

export class SigningError extends Error {}

export type SignerOptions = {
  seed?: string;
  mnemonic?: string;
  nodeUrl?: string;
};

export class TransactionSigner {
  client: Client;
  wallet: Wallet;

  constructor(options: SignerOptions) {
    const nodeUrl = options.nodeUrl ?? "wss://rpc.testnet.postfiat.org:6008";
    this.client = new Client(nodeUrl);

    if (options.mnemonic) {
      this.wallet = Wallet.fromMnemonic(options.mnemonic);
    } else if (options.seed) {
      this.wallet = Wallet.fromSeed(options.seed);
    } else {
      throw new SigningError("Either seed or mnemonic is required");
    }
  }

  async connect() {
    if (!this.client.isConnected()) await this.client.connect();
  }

  async disconnect() {
    if (this.client.isConnected()) await this.client.disconnect();
  }

  async signAndSubmit(txJson: Payment): Promise<string> {
    await this.connect();
    try {
      const response = await this.client.submitAndWait(txJson, { wallet: this.wallet });
      const result = response.result as any;
      // Handle both engine_result (legacy) and meta.TransactionResult (current XRPL response format)
      const txResult = result.engine_result || result.meta?.TransactionResult;
      if (txResult !== "tesSUCCESS") {
        throw new SigningError(`Transaction failed: ${JSON.stringify(result)}`);
      }
      const txHash = result.hash || result.tx_json?.hash;
      if (!txHash) {
        throw new SigningError("Transaction submitted but no tx hash returned");
      }
      return txHash;
    } catch (err) {
      if (err instanceof SigningError) throw err;
      throw new SigningError(String(err));
    } finally {
      await this.disconnect();
    }
  }
}
