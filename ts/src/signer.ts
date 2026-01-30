import { Client, Wallet, xrpToDrops, Payment } from "xrpl";

export class SigningError extends Error {}

export class TransactionSigner {
  client: Client;
  wallet: Wallet;

  constructor(walletSeed: string, nodeUrl = "https://rpc.testnet.postfiat.org:6008") {
    if (!walletSeed) throw new SigningError("walletSeed is required");
    this.client = new Client(nodeUrl);
    this.wallet = Wallet.fromSeed(walletSeed);
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
      if (result.engine_result !== "tesSUCCESS") {
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
