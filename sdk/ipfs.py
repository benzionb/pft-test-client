"""IPFS pinning helpers."""

from __future__ import annotations

import asyncio
from typing import Optional

from .validation import validate_nonempty_content, validate_url, ValidationError


class IPFSPinningError(RuntimeError):
    """Raised when IPFS pinning fails."""


def _normalize_ipfs_endpoint(endpoint: str) -> str:
    """Normalize IPFS endpoint for ipfshttpclient.

    Accepts HTTP URLs or multiaddr strings.
    """
    if endpoint.startswith("/ip4/") or endpoint.startswith("/dns/"):
        return endpoint
    if endpoint.startswith("http://"):
        host_port = endpoint.replace("http://", "")
        if "/" in host_port:
            host_port = host_port.split("/", 1)[0]
        if ":" in host_port:
            host, port = host_port.split(":", 1)
        else:
            host, port = host_port, "5001"
        return f"/ip4/{host}/tcp/{port}/http"
    if endpoint.startswith("https://"):
        host_port = endpoint.replace("https://", "")
        if "/" in host_port:
            host_port = host_port.split("/", 1)[0]
        if ":" in host_port:
            host, port = host_port.split(":", 1)
        else:
            host, port = host_port, "443"
        return f"/dns/{host}/tcp/{port}/https"
    return endpoint


async def pin_content(
    content: bytes,
    endpoint: str = "http://127.0.0.1:5001",
    timeout: float = 30.0,
    pin: bool = True,
) -> str:
    """Pin content to a local IPFS node and return the CID.

    This requires a local IPFS daemon with the HTTP API enabled.
    """
    try:
        validate_nonempty_content(content)
        validate_url(endpoint)
        import ipfshttpclient
    except ImportError as exc:
        raise IPFSPinningError(
            "ipfshttpclient not installed. Run: pip install ipfshttpclient"
        ) from exc
    except ValidationError as exc:
        raise IPFSPinningError(str(exc)) from exc

    def _pin() -> str:
        normalized = _normalize_ipfs_endpoint(endpoint)
        with ipfshttpclient.connect(normalized) as client:
            cid = client.add_bytes(content)
            if pin:
                try:
                    client.pin.add(cid)
                except Exception:
                    # Best effort pin; not fatal for add_bytes
                    pass
            return cid

    try:
        cid = await asyncio.wait_for(asyncio.to_thread(_pin), timeout=timeout)
        if not cid:
            raise IPFSPinningError("IPFS returned empty CID")
        return cid
    except Exception as exc:
        raise IPFSPinningError(f"Failed to pin content: {exc}") from exc


async def pin_content_via_web3_storage(
    content: bytes,
    api_token: str,
    timeout: float = 30.0,
    upload_url: str = "https://api.web3.storage/upload",
) -> str:
    """Pin content using web3.storage and return the CID.

    Requires a Web3.Storage API token.
    """
    try:
        validate_nonempty_content(content)
        import httpx
    except ImportError as exc:
        raise IPFSPinningError(
            "httpx not installed. Run: pip install httpx"
        ) from exc
    except ValidationError as exc:
        raise IPFSPinningError(str(exc)) from exc

    if not api_token:
        raise IPFSPinningError("web3.storage api_token is required")
    try:
        validate_url(upload_url)
    except ValidationError as exc:
        raise IPFSPinningError(str(exc)) from exc
    headers = {"Authorization": f"Bearer {api_token}"}
    try:
        timeout_config = httpx.Timeout(timeout)
        async with httpx.AsyncClient(timeout=timeout_config) as client:
            response = await client.post(
                upload_url,
                headers=headers,
                content=content,
            )
            response.raise_for_status()
            data = response.json()
            cid = data.get("cid")
            if not cid:
                raise IPFSPinningError("web3.storage response missing cid")
            return cid
    except Exception as exc:
        raise IPFSPinningError(f"web3.storage upload failed: {exc}") from exc
