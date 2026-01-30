"""Transaction signing and submission interface."""

from __future__ import annotations

from typing import Dict, Optional, Any


class SigningError(RuntimeError):
    """Raised when signing or submission fails."""


class TransactionSigner:
    """Sign and submit XRP transactions using xrpl-py."""

    def __init__(self, wallet_seed: str, node_url: str = "https://rpc.testnet.postfiat.org:6008"):
        try:
            from xrpl.clients import JsonRpcClient
            from xrpl.wallet import Wallet
        except ImportError as exc:
            raise SigningError(
                "xrpl-py not installed. Run: pip install xrpl-py"
            ) from exc

        self.node_url = node_url
        self.client = JsonRpcClient(node_url)
        try:
            self.wallet = Wallet.from_seed(wallet_seed)
        except Exception as exc:
            raise SigningError(f"Invalid wallet seed: {exc}") from exc

    def close(self) -> None:
        """Close underlying client if supported."""
        if hasattr(self.client, "close"):
            try:
                self.client.close()
            except Exception:
                pass

    def __enter__(self) -> "TransactionSigner":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def sign(self, tx_json: Dict[str, object]) -> Any:
        """Sign a transaction and return the signed transaction object."""
        try:
            from xrpl.models.transactions import Payment
            try:
                from xrpl.transaction import autofill_and_sign
                signer = "autofill_and_sign"
            except Exception:
                from xrpl.transaction import safe_sign_and_autofill_transaction
                signer = "safe_sign_and_autofill_transaction"
        except ImportError as exc:
            raise SigningError(
                "xrpl-py not installed. Run: pip install xrpl-py"
            ) from exc

        if not isinstance(tx_json, dict) or not tx_json:
            raise SigningError("tx_json must be a non-empty dict")

        try:
            payment = Payment.from_dict(tx_json)
            if signer == "autofill_and_sign":
                return autofill_and_sign(payment, self.client, self.wallet)
            return safe_sign_and_autofill_transaction(payment, self.wallet, self.client)
        except Exception as exc:
            raise SigningError(f"Failed to sign transaction: {exc}") from exc

    def sign_and_submit(self, tx_json: Dict[str, object]) -> str:
        """Sign and submit a transaction, return transaction hash."""
        try:
            from xrpl.transaction import submit_and_wait
        except ImportError as exc:
            raise SigningError(
                "xrpl-py not installed. Run: pip install xrpl-py"
            ) from exc

        try:
            signed_tx = self.sign(tx_json)
            response = submit_and_wait(signed_tx, self.client)
            result = response.result
        except Exception as exc:
            raise SigningError(f"Failed to submit transaction: {exc}") from exc

        if result.get("engine_result") != "tesSUCCESS":
            raise SigningError(f"Transaction failed: {result}")

        tx_hash = result.get("hash") or result.get("tx_json", {}).get("hash")
        if not tx_hash:
            raise SigningError("Transaction submitted but no tx hash returned")
        return tx_hash
