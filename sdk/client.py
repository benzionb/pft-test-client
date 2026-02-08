"""High-level Post Fiat Task Node client."""

from __future__ import annotations

from typing import Optional

from .ipfs import pin_content, pin_content_via_web3_storage, IPFSPinningError
from .transaction import build_pointer_transaction
from .signer import TransactionSigner
from .validation import validate_nonempty_content, ValidationError


class PFTClientError(RuntimeError):
    """High-level client error."""


class PFTClient:
    """Post Fiat SDK Client for Task Node pointer submissions."""

    def __init__(
        self,
        wallet_seed: str,
        node_url: str = "https://rpc.testnet.postfiat.org",
        ipfs_endpoint: str = "http://127.0.0.1:5001",
    ):
        self.signer = TransactionSigner(wallet_seed, node_url=node_url)
        self.ipfs_endpoint = ipfs_endpoint

    async def pin_and_build_pointer(
        self,
        content: bytes,
        kind: str = "TASK_SUBMISSION",
        schema: int = 1,
        flags: int = 1,
        use_web3_storage_token: Optional[str] = None,
    ) -> tuple[str, dict]:
        """Pin content and return (cid, tx_json)."""
        try:
            validate_nonempty_content(content)
            if use_web3_storage_token:
                cid = await pin_content_via_web3_storage(content, use_web3_storage_token)
            else:
                cid = await pin_content(content, endpoint=self.ipfs_endpoint)
        except (ValidationError, IPFSPinningError) as exc:
            raise PFTClientError(f"Pinning failed: {exc}") from exc

        try:
            tx_json = build_pointer_transaction(
                self.signer.wallet.address,
                cid,
                kind=kind,
                schema=schema,
                flags=flags,
            )
            return cid, tx_json
        except Exception as exc:
            raise PFTClientError(f"Transaction build failed: {exc}") from exc

    def sign_and_submit(self, tx_json: dict) -> str:
        """Sign and submit a pointer transaction (sync)."""
        try:
            return self.signer.sign_and_submit(tx_json)
        except Exception as exc:
            raise PFTClientError(f"Transaction submission failed: {exc}") from exc

    async def sign_and_submit_async(self, tx_json: dict) -> str:
        """Sign and submit a pointer transaction (async)."""
        try:
            import asyncio
            return await asyncio.to_thread(self.signer.sign_and_submit, tx_json)
        except Exception as exc:
            raise PFTClientError(f"Async transaction submission failed: {exc}") from exc
